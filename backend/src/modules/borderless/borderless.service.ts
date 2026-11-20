import { CrossBorderTransfer, FxQuote, PaymentCorridor, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma, TX_OPTIONS } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { newCrossBorderReference, newTransactionReference } from '../../lib/reference';
import { postLedgerLines, LedgerLine } from '../../services/ledger.service';
import { quoteFee } from '../../services/fee.service';
import { convertMinor, getCurrentRate } from '../../services/fx.service';
import { verifyPin } from '../../services/pin.service';
import { getOrCreateUserWallet, getSystemWallet, systemWalletCode } from '../../services/wallet.service';

/**
 * BorderlessPaymentOrchestrator (blueprint §7): corridor availability, FX quotes with a
 * hard expiry, compliance checks, and cross-border transfers through the corridor's
 * configured provider. The customer picks the corridor/provider; this module never
 * silently reroutes to another one. Unsupported routes are unavailable — a SUSPENDED
 * corridor behaves exactly like a missing one.
 */

export const FX_QUOTE_TTL_MS = 5 * 60_000; // quotes are fresh for 5 minutes

// ─────────────────────── corridors ───────────────────────

export async function listCorridors(): Promise<PaymentCorridor[]> {
  return prisma.paymentCorridor.findMany({ where: { status: 'ACTIVE' }, orderBy: { destinationCountry: 'asc' } });
}

async function loadActiveCorridor(id: string): Promise<PaymentCorridor> {
  const corridor = await prisma.paymentCorridor.findUnique({ where: { id } });
  if (!corridor || corridor.status !== 'ACTIVE') {
    throw new AppError('CORRIDOR_UNAVAILABLE', 'This corridor is not available', 404);
  }
  return corridor;
}

// ─────────────────────── quotes ───────────────────────

/**
 * Builds an FX quote: current rate snapshot + disclosed fee, valid for FX_QUOTE_TTL_MS.
 * The destination amount converts only the principal; the fee is charged on top in the
 * source currency. Rates round down — the customer never receives more than quoted.
 */
export async function createQuote(userId: string, corridorId: string, sourceAmount: bigint): Promise<FxQuote> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.status !== 'ACTIVE') throw new AppError('ACCOUNT_NOT_ACTIVE', 'Your account is not active', 403);
  // Cross-border sends require completed KYC (blueprint §7 compliance checks).
  if (user.kycStatus !== 'APPROVED') {
    throw new AppError('KYC_REQUIRED', 'Complete identity verification before sending money abroad', 403);
  }

  const corridor = await loadActiveCorridor(corridorId);
  if (sourceAmount < corridor.minAmount || sourceAmount > corridor.maxAmount) {
    throw new AppError('AMOUNT_OUT_OF_RANGE', 'Amount is outside this corridor’s limits', 422, {
      min: corridor.minAmount.toString(),
      max: corridor.maxAmount.toString(),
    });
  }

  const rate = await getCurrentRate(prisma, corridor.sourceCurrency, corridor.destinationCurrency);
  const fee = await quoteFee('FX_CONVERSION', sourceAmount);
  const [sourceCurrency, destCurrency] = await Promise.all([
    prisma.currency.findUniqueOrThrow({ where: { code: corridor.sourceCurrency } }),
    prisma.currency.findUniqueOrThrow({ where: { code: corridor.destinationCurrency } }),
  ]);
  const destinationAmount = convertMinor(sourceAmount, rate.rate, sourceCurrency.minorUnits, destCurrency.minorUnits);
  if (destinationAmount <= 0n) throw new AppError('AMOUNT_TOO_SMALL', 'This amount converts to zero', 422);

  return prisma.fxQuote.create({
    data: {
      userId,
      corridorId,
      sourceAmount,
      sourceCurrency: corridor.sourceCurrency,
      destinationAmount,
      destinationCurrency: corridor.destinationCurrency,
      rate: rate.rate,
      exchangeRateId: rate.id,
      feeAmount: fee,
      providerName: corridor.providerName,
      expiresAt: new Date(Date.now() + FX_QUOTE_TTL_MS),
    },
  });
}

async function loadUsableQuote(userId: string, quoteId: string): Promise<FxQuote> {
  const quote = await prisma.fxQuote.findUnique({ where: { id: quoteId } });
  if (!quote || quote.userId !== userId) throw new AppError('QUOTE_NOT_FOUND', 'Quote not found', 404);
  if (quote.status === 'OPEN' && quote.expiresAt.getTime() <= Date.now()) {
    await prisma.fxQuote.update({ where: { id: quote.id }, data: { status: 'EXPIRED' } });
    throw new AppError('QUOTE_EXPIRED', 'This quote has expired; request a fresh one', 410);
  }
  if (quote.status !== 'OPEN' && quote.status !== 'ACCEPTED') {
    throw new AppError('QUOTE_NOT_USABLE', `This quote is ${quote.status.toLowerCase()}`, 409);
  }
  return quote;
}

export async function acceptQuote(userId: string, quoteId: string): Promise<FxQuote> {
  const quote = await loadUsableQuote(userId, quoteId);
  if (quote.status === 'ACCEPTED') return quote;
  const result = await prisma.fxQuote.updateMany({
    where: { id: quote.id, status: 'OPEN' },
    data: { status: 'ACCEPTED', acceptedAt: new Date() },
  });
  if (result.count !== 1) throw new AppError('QUOTE_NOT_USABLE', 'This quote is no longer available', 409);
  return prisma.fxQuote.findUniqueOrThrow({ where: { id: quote.id } });
}

// ─────────────────────── transfers ───────────────────────

/**
 * Executes a cross-border send against an accepted, unexpired quote. The ledger movement
 * is one FX_CONVERSION transaction: sender debited (principal + fee), recipient credited
 * the quoted destination amount, and the FX position wallets balance both currencies.
 * One transfer per quote; a retried request replays the original.
 */
export async function executeTransfer(
  userId: string,
  quoteId: string,
  recipientPhone: string,
  pin: string,
  idempotencyKey: string,
): Promise<CrossBorderTransfer> {
  const quote = await loadUsableQuote(userId, quoteId);
  await verifyPin(userId, pin);

  const corridor = await loadActiveCorridor(quote.corridorId);
  const recipient = await prisma.user.findUnique({ where: { phoneNumber: recipientPhone } });
  if (!recipient || recipient.status !== 'ACTIVE') {
    throw new AppError('RECIPIENT_NOT_FOUND', 'No active SurePesa account uses this number', 404);
  }
  if (recipient.id === userId) throw new AppError('SELF_TRANSFER', 'You cannot send to yourself', 422);

  // Idempotent replay.
  const existing = await prisma.crossBorderTransfer.findFirst({
    where: { senderId: userId, idempotencyKey },
  });
  if (existing) return existing;

  // One transfer per quote.
  const used = await prisma.crossBorderTransfer.findUnique({ where: { quoteId: quote.id } });
  if (used) throw new AppError('QUOTE_ALREADY_USED', 'This quote has already been executed', 409);

  try {
    return await prisma.$transaction(async (tx) => {
      const senderWallet = await getOrCreateUserWallet(tx, userId, quote.sourceCurrency);
      const recipientWallet = await getOrCreateUserWallet(tx, recipient.id, quote.destinationCurrency);
      const feesWallet = await getSystemWallet(tx, systemWalletCode.fees(quote.sourceCurrency));
      const fxSource = await getSystemWallet(tx, systemWalletCode.fx(quote.sourceCurrency));
      const fxDest = await getSystemWallet(tx, systemWalletCode.fx(quote.destinationCurrency));

      const txn = await tx.transaction.create({
        data: {
          reference: newTransactionReference(),
          type: 'FX_CONVERSION',
          status: 'PROCESSING',
          initiatorUserId: userId,
          idempotencyKey: `borderless:${quote.id}:${idempotencyKey}`,
          sourceWalletId: senderWallet.id,
          destinationWalletId: recipientWallet.id,
          amount: quote.sourceAmount,
          currencyCode: quote.sourceCurrency,
          fee: quote.feeAmount,
          destinationAmount: quote.destinationAmount,
          destinationCurrencyCode: quote.destinationCurrency,
          exchangeRateId: quote.exchangeRateId,
          exchangeRate: quote.rate,
          providerName: corridor.providerName,
          description: `Borderless send to ${recipientCountry(corridor)}`,
          events: { create: { fromStatus: null, toStatus: 'PROCESSING', actorType: 'USER', actorId: userId } },
        },
      });

      const lines: LedgerLine[] = [
        { walletId: senderWallet.id, amount: -quote.sourceAmount, entryType: 'PRINCIPAL' },
        { walletId: recipientWallet.id, amount: quote.destinationAmount, entryType: 'PRINCIPAL' },
        // FX position legs keep every currency balanced.
        { walletId: fxSource.id, amount: quote.sourceAmount, entryType: 'FX' },
        { walletId: fxDest.id, amount: -quote.destinationAmount, entryType: 'FX' },
      ];
      if (quote.feeAmount > 0n) {
        lines.push(
          { walletId: senderWallet.id, amount: -quote.feeAmount, entryType: 'FEE' },
          { walletId: feesWallet.id, amount: quote.feeAmount, entryType: 'FEE' },
        );
      }
      await postLedgerLines(tx, txn.id, lines);

      const transfer = await tx.crossBorderTransfer.create({
        data: {
          reference: newCrossBorderReference(),
          senderId: userId,
          recipientId: recipient.id,
          recipientPhone,
          recipientCountry: corridor.destinationCountry,
          corridorId: corridor.id,
          quoteId: quote.id,
          status: 'SUCCESS',
          transactionId: txn.id,
          idempotencyKey,
          completedAt: new Date(),
        },
      });
      await tx.fxQuote.update({ where: { id: quote.id }, data: { status: 'ACCEPTED' } });
      await tx.transaction.update({
        where: { id: txn.id },
        data: { status: 'SUCCESS', completedAt: new Date(), events: { create: { fromStatus: 'PROCESSING', toStatus: 'SUCCESS', actorType: 'SYSTEM' } } },
      });
      // Partner settlement tracking (prototype: the simulated partner settles instantly).
      await tx.providerSettlement.create({
        data: {
          providerName: corridor.providerName,
          transferId: transfer.id,
          reference: `SET-${randomUUID().slice(0, 12).toUpperCase()}`,
          amount: quote.destinationAmount,
          currencyCode: quote.destinationCurrency,
          valueDate: new Date(),
          status: 'PENDING',
        },
      });
      await tx.notification.create({
        data: {
          userId: recipient.id,
          channel: 'IN_APP',
          title: 'Money received from abroad',
          body: `You received a cross-border transfer (${transfer.reference}).`,
          data: { transferId: transfer.id },
        },
      });
      return transfer;
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const replay = await prisma.crossBorderTransfer.findFirst({ where: { senderId: userId, idempotencyKey } });
      if (replay) return replay;
    }
    throw err;
  }
}

function recipientCountry(corridor: PaymentCorridor): string {
  return corridor.destinationCountry;
}

export async function listTransfers(userId: string, before?: Date, limit = 20) {
  return prisma.crossBorderTransfer.findMany({
    where: { OR: [{ senderId: userId }, { recipientId: userId }], ...(before ? { createdAt: { lt: before } } : {}) },
    include: { corridor: true, quote: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getTransfer(userId: string, id: string) {
  const transfer = await prisma.crossBorderTransfer.findUnique({
    where: { id },
    include: { corridor: true, quote: true, settlements: true },
  });
  if (!transfer || (transfer.senderId !== userId && transfer.recipientId !== userId)) {
    throw new AppError('TRANSFER_NOT_FOUND', 'Transfer not found', 404);
  }
  return transfer;
}

/** Marks OPEN quotes past their expiry as EXPIRED (scheduled job). */
export async function expireOverdueQuotes(now = new Date()): Promise<number> {
  const result = await prisma.fxQuote.updateMany({
    where: { status: 'OPEN', expiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}
