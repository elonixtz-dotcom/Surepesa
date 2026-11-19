import {
  ActorType,
  Prisma,
  Transaction,
  TransactionStatus,
  TransactionType,
  User,
} from '@prisma/client';
import { prisma, TX_OPTIONS } from '../lib/prisma';
import { AppError, PaymentRejectedError } from '../lib/errors';
import { newTransactionReference } from '../lib/reference';
import { LedgerLine, postLedgerLines } from './ledger.service';
import { quoteFee } from './fee.service';
import {
  getOrCreateBusinessWallet,
  getOrCreateUserWallet,
  getSystemWallet,
  systemWalletCode,
} from './wallet.service';
import { env } from '../config/env';
import { getProvider, simulatedProvider } from '../providers';
import { assertSimulatorAllowed } from '../providers/simulator-policy';
import { ProviderResult } from '../providers/payment-provider';

/**
 * Payment engine.
 *
 * Every flow follows the same shape:
 *   1. Authorise on the server (never trust the client's view of balances or ownership).
 *   2. Record the intent as a Transaction (idempotent per initiator + key).
 *   3. Move money with a single ledger posting inside one DB transaction.
 *   4. Record the outcome: SUCCESS, or FAILED with a reason — money never half-moves.
 */

export interface Actor {
  type: ActorType;
  id?: string;
}

export const SYSTEM: Actor = { type: 'SYSTEM' };

// ───────────────────────── Policy ─────────────────────────

/** Rules a user must meet before money can leave their wallet. */
export function assertCanSend(user: User): void {
  if (user.status !== 'ACTIVE') {
    throw new PaymentRejectedError('ACCOUNT_NOT_ACTIVE', 'Your account is not active');
  }
  if (user.kycStatus !== 'APPROVED') {
    throw new PaymentRejectedError('KYC_REQUIRED', 'Verify your identity before sending money');
  }
}

function assertCanReceive(user: User): void {
  if (user.status !== 'ACTIVE') {
    throw new PaymentRejectedError('RECIPIENT_NOT_ACTIVE', 'The recipient cannot receive payments');
  }
}

export function assertPositive(amount: bigint): void {
  if (amount <= 0n) throw new AppError('INVALID_AMOUNT', 'Amount must be greater than zero');
}

export async function loadUser(userId: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('USER_NOT_FOUND', 'User not found', 404);
  return user;
}

// ─────────────────────── Core engine ───────────────────────
// Exported for other money flows (virtual cards). Every flow still goes through these.

export interface TransactionIntent {
  type: TransactionType;
  initiatorUserId?: string;
  initiatorAdminId?: string;
  idempotencyKey?: string;
  sourceWalletId: string;
  destinationWalletId: string;
  amount: bigint;
  currencyCode: string;
  fee?: bigint;
  description?: string;
  paymentMethodId?: string;
  qrCodeId?: string;
  providerName?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Creates the Transaction row in PROCESSING. If the same initiator already used this
 * idempotency key, returns the original transaction instead (`replayed: true`).
 */
export async function openTransaction(
  intent: TransactionIntent,
  actor: Actor,
): Promise<{ txn: Transaction; replayed: boolean }> {
  const findExisting = () =>
    intent.idempotencyKey && intent.initiatorUserId
      ? prisma.transaction.findUnique({
          where: {
            initiatorUserId_idempotencyKey: {
              initiatorUserId: intent.initiatorUserId,
              idempotencyKey: intent.idempotencyKey,
            },
          },
        })
      : Promise.resolve(null);

  const checkReplay = (existing: Transaction) => {
    const same =
      existing.type === intent.type &&
      existing.amount === intent.amount &&
      existing.destinationWalletId === intent.destinationWalletId;
    if (!same) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used for a different payment',
        409,
      );
    }
    return { txn: existing, replayed: true };
  };

  const existing = await findExisting();
  if (existing) return checkReplay(existing);

  try {
    const txn = await prisma.transaction.create({
      data: {
        reference: newTransactionReference(),
        type: intent.type,
        status: 'PROCESSING',
        initiatorUserId: intent.initiatorUserId,
        initiatorAdminId: intent.initiatorAdminId,
        idempotencyKey: intent.idempotencyKey,
        sourceWalletId: intent.sourceWalletId,
        destinationWalletId: intent.destinationWalletId,
        amount: intent.amount,
        currencyCode: intent.currencyCode,
        fee: intent.fee ?? 0n,
        description: intent.description,
        paymentMethodId: intent.paymentMethodId,
        qrCodeId: intent.qrCodeId,
        providerName: intent.providerName,
        metadata: intent.metadata,
        events: {
          create: { fromStatus: null, toStatus: 'PROCESSING', actorType: actor.type, actorId: actor.id },
        },
      },
    });
    return { txn, replayed: false };
  } catch (err) {
    // Two identical requests raced past findExisting(); the unique index picked a winner.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await findExisting();
      if (winner) return checkReplay(winner);
    }
    throw err;
  }
}

/** Standard lines: principal source -> destination, fee source -> fee wallet. */
export function transferLines(
  sourceWalletId: string,
  destinationWalletId: string,
  amount: bigint,
  fee: bigint,
  feeWalletId: string,
): LedgerLine[] {
  const lines: LedgerLine[] = [
    { walletId: sourceWalletId, amount: -amount, entryType: 'PRINCIPAL' },
    { walletId: destinationWalletId, amount, entryType: 'PRINCIPAL' },
  ];
  if (fee > 0n) {
    lines.push(
      { walletId: sourceWalletId, amount: -fee, entryType: 'FEE' },
      { walletId: feeWalletId, amount: fee, entryType: 'FEE' },
    );
  }
  return lines;
}

export async function transition(
  tx: Prisma.TransactionClient,
  txn: Transaction,
  to: TransactionStatus,
  actor: Actor,
  extra: Prisma.TransactionUpdateInput = {},
  note?: string,
): Promise<Transaction> {
  return tx.transaction.update({
    where: { id: txn.id },
    data: {
      ...extra,
      status: to,
      completedAt: to === 'SUCCESS' || to === 'FAILED' || to === 'REVERSED' ? new Date() : undefined,
      events: {
        create: { fromStatus: txn.status, toStatus: to, actorType: actor.type, actorId: actor.id, note },
      },
    },
  });
}

/** Marks a transaction FAILED without moving money. */
export async function failTransaction(txn: Transaction, code: string, reason: string, actor: Actor = SYSTEM) {
  return transition(prisma, txn, 'FAILED', actor, { failureCode: code, failureReason: reason }, reason);
}

/**
 * Posts the ledger lines and moves the transaction to `finalStatus` atomically.
 * Business rejections (insufficient funds, frozen wallet ...) mark it FAILED.
 */
export async function settle(
  txn: Transaction,
  buildLines: (tx: Prisma.TransactionClient) => Promise<LedgerLine[]>,
  actor: Actor,
  finalStatus: TransactionStatus = 'SUCCESS',
  extra: Prisma.TransactionUpdateInput = {},
): Promise<Transaction> {
  try {
    return await prisma.$transaction(async (tx) => {
      await postLedgerLines(tx, txn.id, await buildLines(tx));
      return finalStatus === txn.status
        ? tx.transaction.update({ where: { id: txn.id }, data: extra })
        : transition(tx, txn, finalStatus, actor, extra);
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof PaymentRejectedError) {
      return failTransaction(txn, err.code, err.message, actor);
    }
    // Unexpected error: the DB transaction rolled back, so no money moved.
    await failTransaction(txn, 'INTERNAL_ERROR', 'Payment could not be completed').catch(() => undefined);
    throw err;
  }
}

/** Runs a flow for a txn that was just opened; replays return the stored result untouched. */
export async function run(
  opened: { txn: Transaction; replayed: boolean },
  execute: (txn: Transaction) => Promise<Transaction>,
): Promise<Transaction> {
  return opened.replayed ? opened.txn : execute(opened.txn);
}

// ───────────────────────── Flows ─────────────────────────

export interface SendMoneyInput {
  senderUserId: string;
  recipientUserId: string;
  amount: bigint;
  currency?: string;
  idempotencyKey: string;
  description?: string;
}

/** Person-to-person transfer between SurePesa wallets. */
export async function sendMoney(input: SendMoneyInput): Promise<Transaction> {
  const currency = input.currency ?? 'TZS';
  assertPositive(input.amount);
  if (input.senderUserId === input.recipientUserId) {
    throw new AppError('SELF_TRANSFER', 'You cannot send money to yourself');
  }
  const [sender, recipient] = await Promise.all([loadUser(input.senderUserId), loadUser(input.recipientUserId)]);
  assertCanSend(sender);
  assertCanReceive(recipient);

  const [source, destination] = await Promise.all([
    getOrCreateUserWallet(prisma, sender.id, currency),
    getOrCreateUserWallet(prisma, recipient.id, currency),
  ]);
  const fee = await quoteFee('P2P_TRANSFER', input.amount);
  const actor: Actor = { type: 'USER', id: sender.id };

  const opened = await openTransaction(
    {
      type: 'P2P_TRANSFER',
      initiatorUserId: sender.id,
      idempotencyKey: input.idempotencyKey,
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
      amount: input.amount,
      currencyCode: currency,
      fee,
      description: input.description,
    },
    actor,
  );

  return run(opened, (txn) =>
    settle(
      txn,
      async (tx) =>
        transferLines(source.id, destination.id, txn.amount, txn.fee, (await getSystemWallet(tx, systemWalletCode.fees(currency))).id),
      actor,
    ),
  );
}

export interface PayMerchantInput {
  payerUserId: string;
  businessId: string;
  amount: bigint;
  currency?: string;
  idempotencyKey: string;
  qrCodeId?: string;
  description?: string;
}

/** Consumer -> merchant payment (e.g. after scanning a SurePesa QR code). */
export async function payMerchant(input: PayMerchantInput): Promise<Transaction> {
  const currency = input.currency ?? 'TZS';
  assertPositive(input.amount);
  const payer = await loadUser(input.payerUserId);
  assertCanSend(payer);

  const business = await prisma.business.findUnique({ where: { id: input.businessId } });
  if (!business || !business.isActive) {
    throw new PaymentRejectedError('MERCHANT_UNAVAILABLE', 'This merchant cannot accept payments');
  }
  if (business.ownerId === payer.id) {
    throw new AppError('SELF_TRANSFER', 'You cannot pay your own business');
  }

  // A retry of a payment already made returns its receipt, even though its QR is now used.
  const isRetry = Boolean(
    await prisma.transaction.findUnique({
      where: { initiatorUserId_idempotencyKey: { initiatorUserId: payer.id, idempotencyKey: input.idempotencyKey } },
      select: { id: true },
    }),
  );
  if (input.qrCodeId && !isRetry) await assertQrPayable(input.qrCodeId, business.id, input.amount, currency);

  const [source, destination] = await Promise.all([
    getOrCreateUserWallet(prisma, payer.id, currency),
    getOrCreateBusinessWallet(prisma, business.id, currency),
  ]);
  const fee = await quoteFee('MERCHANT_PAYMENT', input.amount);
  const actor: Actor = { type: 'USER', id: payer.id };

  const opened = await openTransaction(
    {
      type: 'MERCHANT_PAYMENT',
      initiatorUserId: payer.id,
      idempotencyKey: input.idempotencyKey,
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
      amount: input.amount,
      currencyCode: currency,
      fee,
      qrCodeId: input.qrCodeId,
      description: input.description ?? business.tradingName,
    },
    actor,
  );

  return run(opened, (txn) =>
    settle(
      txn,
      async (tx) => {
        // Claimed in the same DB transaction that moves the money: two payments racing for one
        // dynamic code cannot both succeed, and a payment that fails leaves the code unused.
        if (txn.qrCodeId) await claimDynamicQr(tx, txn.qrCodeId);
        return transferLines(source.id, destination.id, txn.amount, txn.fee, (await getSystemWallet(tx, systemWalletCode.fees(currency))).id);
      },
      actor,
    ),
  );
}

/**
 * Checks a scanned QR code before any transaction is created, so the customer gets a clear
 * reason. Static codes (customer enters the amount) only need to be active and belong to the
 * merchant; dynamic codes (a payment request) also fix the amount, expire, and work once.
 */
async function assertQrPayable(qrCodeId: string, businessId: string, amount: bigint, currency: string): Promise<void> {
  const qr = await prisma.qrCode.findUnique({ where: { id: qrCodeId } });
  if (!qr || qr.businessId !== businessId || !qr.isActive) {
    throw new PaymentRejectedError('QR_INVALID', 'This QR code is not valid for this merchant');
  }
  if (qr.type !== 'DYNAMIC') return;
  if (qr.usedAt) throw new PaymentRejectedError('QR_ALREADY_USED', 'This payment request has already been paid');
  if (qr.expiresAt && qr.expiresAt <= new Date()) {
    throw new PaymentRejectedError('QR_EXPIRED', 'This payment request has expired. Ask the merchant for a new code.');
  }
  if (qr.amount !== amount || qr.currencyCode !== currency) {
    throw new PaymentRejectedError('QR_AMOUNT_MISMATCH', 'The amount must match the payment request');
  }
}

/** Marks a dynamic QR as used; throws (rolling back the payment) if it was used or expired meanwhile. */
async function claimDynamicQr(tx: Prisma.TransactionClient, qrCodeId: string): Promise<void> {
  const qr = await tx.qrCode.findUniqueOrThrow({ where: { id: qrCodeId }, select: { type: true } });
  if (qr.type !== 'DYNAMIC') return;
  const now = new Date();
  const { count } = await tx.qrCode.updateMany({
    where: { id: qrCodeId, usedAt: null, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    data: { usedAt: now },
  });
  if (count !== 1) throw new PaymentRejectedError('QR_ALREADY_USED', 'This payment request has already been paid or has expired');
}

export interface ExternalTransferInput {
  userId: string;
  paymentMethodId: string;
  amount: bigint;
  idempotencyKey: string;
}

async function loadPaymentMethod(userId: string, paymentMethodId: string) {
  const method = await prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } });
  if (!method || method.userId !== userId) {
    throw new AppError('PAYMENT_METHOD_NOT_FOUND', 'Payment method not found', 404);
  }
  if (method.status === 'DISABLED') {
    throw new PaymentRejectedError('PAYMENT_METHOD_DISABLED', 'This payment method is disabled');
  }
  return method;
}

/** "Add money": pull from the user's mobile-money / bank account into their wallet. */
export async function deposit(input: ExternalTransferInput): Promise<Transaction> {
  assertPositive(input.amount);
  const user = await loadUser(input.userId);
  if (user.status !== 'ACTIVE') throw new PaymentRejectedError('ACCOUNT_NOT_ACTIVE', 'Your account is not active');
  const method = await loadPaymentMethod(user.id, input.paymentMethodId);
  const provider = getProvider(method.provider);
  if (provider.name === simulatedProvider.name) assertSimulatorAllowed(env.SIMULATED_RAILS, user);
  const currency = method.currencyCode;

  const [wallet, float] = await Promise.all([
    getOrCreateUserWallet(prisma, user.id, currency),
    getSystemWallet(prisma, systemWalletCode.float(currency, provider.name)),
  ]);
  const actor: Actor = { type: 'USER', id: user.id };

  const opened = await openTransaction(
    {
      type: 'DEPOSIT',
      initiatorUserId: user.id,
      idempotencyKey: input.idempotencyKey,
      sourceWalletId: float.id,
      destinationWalletId: wallet.id,
      amount: input.amount,
      currencyCode: currency,
      fee: await quoteFee('DEPOSIT', input.amount),
      paymentMethodId: method.id,
      providerName: provider.name,
    },
    actor,
  );

  return run(opened, async (txn) => {
    // Nothing is credited until the rail confirms the money arrived.
    const result = await callRail(() =>
      provider.collect({ reference: txn.reference, amount: txn.amount, currency, accountNumber: method.accountNumber }),
    );
    return (await applyRailOutcome(txn.id, result, 'initial response')).txn;
  });
}

/**
 * Withdraw to the user's mobile-money / bank account.
 * Funds leave the wallet *before* the payout is requested, so they cannot be spent twice;
 * a failed payout is automatically reversed. A timed-out or ambiguous payout keeps the funds
 * held until the rail answers — they are never returned while the payout might have gone out.
 */
export async function withdraw(input: ExternalTransferInput): Promise<Transaction> {
  assertPositive(input.amount);
  const user = await loadUser(input.userId);
  assertCanSend(user);
  const method = await loadPaymentMethod(user.id, input.paymentMethodId);
  const provider = getProvider(method.provider);
  if (provider.name === simulatedProvider.name) assertSimulatorAllowed(env.SIMULATED_RAILS, user);
  const currency = method.currencyCode;

  const [wallet, float] = await Promise.all([
    getOrCreateUserWallet(prisma, user.id, currency),
    getSystemWallet(prisma, systemWalletCode.float(currency, provider.name)),
  ]);
  const actor: Actor = { type: 'USER', id: user.id };

  const opened = await openTransaction(
    {
      type: 'WITHDRAWAL',
      initiatorUserId: user.id,
      idempotencyKey: input.idempotencyKey,
      sourceWalletId: wallet.id,
      destinationWalletId: float.id,
      amount: input.amount,
      currencyCode: currency,
      fee: await quoteFee('WITHDRAWAL', input.amount),
      paymentMethodId: method.id,
      providerName: provider.name,
    },
    actor,
  );

  return run(opened, async (txn) => {
    // Step 1: debit the wallet (status stays PROCESSING until the provider confirms).
    const debited = await settle(
      txn,
      async (tx) => transferLines(wallet.id, float.id, txn.amount, txn.fee, (await getSystemWallet(tx, systemWalletCode.fees(currency))).id),
      actor,
      'PROCESSING',
    );
    if (debited.status === 'FAILED') return debited;

    // Step 2: ask the rail to pay out. Step 3 (confirm or refund) happens in applyRailOutcome,
    // now or later from a callback or the rail-sync job.
    const result = await callRail(() =>
      provider.payout({ reference: txn.reference, amount: txn.amount, currency, accountNumber: method.accountNumber }),
    );
    return (await applyRailOutcome(txn.id, result, 'initial response')).txn;
  });
}

// ─────────────────── External rail outcomes ───────────────────

/** Selcom's documented guidance for INPROGRESS/AMBIGUOUS: re-query every 3 minutes. */
export const RAIL_RECHECK_MS = 3 * 60_000;
/** After this many unanswered status checks (~30 minutes) Finance must investigate. */
export const RAIL_MAX_CHECKS = 10;

/** A thrown error (timeout, connection reset) means we cannot know whether money moved. */
async function callRail(call: () => Promise<ProviderResult>): Promise<ProviderResult> {
  try {
    return await call();
  } catch (err) {
    return { status: 'AMBIGUOUS', failureReason: err instanceof Error ? err.message : 'Rail call failed' };
  }
}

export type RailOutcome = 'APPLIED' | 'ALREADY_FINAL' | 'NOT_FINAL' | 'ESCALATED';

const RAIL_TYPES: TransactionType[] = ['DEPOSIT', 'WITHDRAWAL'];

/**
 * Applies a rail's answer to a deposit or withdrawal. Safe to call any number of times and
 * concurrently (initial response, callbacks and the status poller all funnel through here):
 * the transaction row is locked and only a PROCESSING transaction changes.
 */
export async function applyRailOutcome(
  transactionId: string,
  result: ProviderResult,
  source: string,
): Promise<{ txn: Transaction; outcome: RailOutcome }> {
  const current = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  if (!RAIL_TYPES.includes(current.type)) {
    throw new AppError('NOT_A_RAIL_TRANSACTION', `${current.type} does not use an external rail`, 409);
  }
  if (current.status !== 'PROCESSING') return { txn: current, outcome: 'ALREADY_FINAL' };

  if (result.status === 'PENDING' || result.status === 'AMBIGUOUS') {
    const waiting = await recordRailWaiting(current, result, source);
    return { txn: waiting, outcome: waiting.escalatedAt ? 'ESCALATED' : 'NOT_FINAL' };
  }

  const railFields = {
    providerReference: result.providerReference ?? current.providerReference ?? undefined,
    railStatus: result.status,
    nextRailCheckAt: null,
  } satisfies Prisma.TransactionUpdateInput;

  if (current.type === 'WITHDRAWAL' && result.status === 'FAILED') {
    // The payout did not happen: give the held funds back. reverseTransaction locks the row
    // and refuses if someone else already finalised it.
    try {
      await reverseTransaction(current.id, {
        actor: SYSTEM,
        reason: result.failureReason ?? 'Payout failed',
        allowFromStatus: 'PROCESSING',
        markOriginalAs: 'FAILED',
        originalUpdate: { ...railFields, failureCode: result.failureCode ?? 'PAYOUT_FAILED', failureReason: result.failureReason },
      });
    } catch (err) {
      if (!(err instanceof AppError && (err.code === 'NOT_REVERSIBLE' || err.code === 'ALREADY_REVERSED'))) throw err;
      return { txn: await prisma.transaction.findUniqueOrThrow({ where: { id: current.id } }), outcome: 'ALREADY_FINAL' };
    }
    return { txn: await prisma.transaction.findUniqueOrThrow({ where: { id: current.id } }), outcome: 'APPLIED' };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${current.id}::uuid FOR UPDATE`;
      const txn = await tx.transaction.findUniqueOrThrow({ where: { id: current.id } });
      if (txn.status !== 'PROCESSING') return { txn, outcome: 'ALREADY_FINAL' as const };

      if (result.status === 'FAILED') {
        // Deposit the rail declined: nothing was credited, so nothing to undo.
        const reason = result.failureReason ?? 'Declined by provider';
        const failed = await transition(tx, txn, 'FAILED', SYSTEM, { ...railFields, failureCode: result.failureCode ?? 'PROVIDER_DECLINED', failureReason: reason }, `${reason} (${source})`);
        return { txn: failed, outcome: 'APPLIED' as const };
      }

      if (txn.type === 'DEPOSIT') {
        const feeWallet = await getSystemWallet(tx, systemWalletCode.fees(txn.currencyCode));
        await postLedgerLines(tx, txn.id, transferLines(txn.sourceWalletId!, txn.destinationWalletId!, txn.amount, txn.fee, feeWallet.id));
      }
      // Withdrawal: the wallet was already debited when the payout was requested.
      const done = await transition(tx, txn, 'SUCCESS', SYSTEM, railFields, `Confirmed by rail (${source})`);
      return { txn: done, outcome: 'APPLIED' as const };
    }, TX_OPTIONS);
  } catch (err) {
    if (!(err instanceof PaymentRejectedError)) throw err;
    // The rail took the customer's money but we cannot credit the wallet (frozen, closed ...).
    // Failing it would lose the money; a person has to decide.
    return { txn: await escalate(current, `${err.code}: ${err.message}`), outcome: 'ESCALATED' };
  }
}

async function recordRailWaiting(txn: Transaction, result: ProviderResult, source: string): Promise<Transaction> {
  const checks = source === 'status query' ? txn.railCheckCount + 1 : txn.railCheckCount;
  const exhausted = checks >= RAIL_MAX_CHECKS;
  const updated = await prisma.transaction.update({
    where: { id: txn.id },
    data: {
      providerReference: result.providerReference ?? txn.providerReference ?? undefined,
      railStatus: result.status,
      railCheckCount: checks,
      nextRailCheckAt: txn.escalatedAt || exhausted ? null : new Date(Date.now() + RAIL_RECHECK_MS),
      events: {
        create: {
          fromStatus: txn.status,
          toStatus: txn.status,
          actorType: 'SYSTEM',
          note: `Rail answered ${result.status} (${source})${result.failureReason ? `: ${result.failureReason}` : ''}`,
        },
      },
    },
  });
  if (exhausted && !txn.escalatedAt) {
    return escalate(updated, `No final answer from ${txn.providerName ?? 'the rail'} after ${checks} status checks`);
  }
  return updated;
}

/** Leaves the transaction PROCESSING (funds held, nothing guessed) and flags it for Finance. */
async function escalate(txn: Transaction, reason: string): Promise<Transaction> {
  return prisma.transaction.update({
    where: { id: txn.id },
    data: {
      escalatedAt: new Date(),
      escalationReason: reason,
      nextRailCheckAt: null,
      events: { create: { fromStatus: txn.status, toStatus: txn.status, actorType: 'SYSTEM', note: `Escalated to Finance: ${reason}` } },
    },
  });
}

export interface ReverseOptions {
  actor: Actor;
  reason: string;
  /** Internal use: withdrawals are reversed from PROCESSING when the payout fails. */
  allowFromStatus?: TransactionStatus;
  /** Status given to the original; REVERSED unless the original never completed. */
  markOriginalAs?: TransactionStatus;
  originalUpdate?: Prisma.TransactionUpdateInput;
}

/**
 * Creates a REVERSAL transaction that posts the exact opposite of the original's ledger
 * lines, then marks the original REVERSED. Fails (and changes nothing) if the receiver
 * no longer has the funds.
 */
export async function reverseTransaction(transactionId: string, opts: ReverseOptions): Promise<Transaction> {
  return prisma.$transaction(async (tx) => {
    // Lock the original so two admins cannot reverse it at the same time.
    await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${transactionId}::uuid FOR UPDATE`;
    const original = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: { ledgerEntries: { orderBy: { id: 'asc' } }, reversedBy: true, refundedBy: { where: { status: 'SUCCESS' }, select: { id: true } } },
    });
    if (!original) throw new AppError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404);
    if (original.reversedBy) throw new AppError('ALREADY_REVERSED', 'Transaction has already been reversed', 409);
    if (original.refundedBy.length) {
      throw new AppError('PARTIALLY_REFUNDED', 'This payment already has refunds; refund the remaining amount instead', 409);
    }
    const allowed: TransactionStatus[] = ['SUCCESS', ...(opts.allowFromStatus ? [opts.allowFromStatus] : [])];
    if (!allowed.includes(original.status) || original.type === 'REVERSAL') {
      throw new AppError('NOT_REVERSIBLE', `A ${original.status} ${original.type} cannot be reversed`, 409);
    }
    if (!original.ledgerEntries.length) {
      throw new AppError('NOT_REVERSIBLE', 'Transaction has no ledger postings', 409);
    }

    const reversal = await tx.transaction.create({
      data: {
        reference: newTransactionReference(),
        type: 'REVERSAL',
        status: 'PROCESSING',
        initiatorAdminId: opts.actor.type === 'ADMIN' ? opts.actor.id : undefined,
        sourceWalletId: original.destinationWalletId,
        destinationWalletId: original.sourceWalletId,
        amount: original.amount,
        currencyCode: original.currencyCode,
        fee: original.fee,
        reversesTransactionId: original.id,
        description: opts.reason,
        events: { create: { toStatus: 'PROCESSING', actorType: opts.actor.type, actorId: opts.actor.id, note: opts.reason } },
      },
    });

    await postLedgerLines(
      tx,
      reversal.id,
      original.ledgerEntries.map((e) => ({ walletId: e.walletId, amount: -e.amount, entryType: 'REVERSAL' })),
    );

    await transition(tx, original, opts.markOriginalAs ?? 'REVERSED', opts.actor, opts.originalUpdate, opts.reason);
    if (opts.actor.type === 'ADMIN') {
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: opts.actor.id,
          action: 'TRANSACTION_REVERSED',
          entityType: 'Transaction',
          entityId: original.id,
          before: { status: original.status },
          after: { status: 'REVERSED', reversalId: reversal.id, reason: opts.reason },
        },
      });
    }
    return transition(tx, reversal, 'SUCCESS', opts.actor);
  }, TX_OPTIONS);
}

// ───────────────────────── Refunds ─────────────────────────

export interface RefundInput {
  transactionId: string;
  amount: bigint;
  reason: string;
  actor: Actor;
}

/** Amount of a payment that can still be refunded. */
export async function refundableAmount(transactionId: string): Promise<bigint> {
  const original = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { refundedBy: { where: { status: 'SUCCESS' }, select: { amount: true } } },
  });
  if (!original || original.type !== 'MERCHANT_PAYMENT' || original.status !== 'SUCCESS') return 0n;
  return original.amount - original.refundedBy.reduce((sum, r) => sum + r.amount, 0n);
}

/**
 * Returns all or part of a merchant payment to the payer, as a new REFUND transaction linked
 * to the original. Several partial refunds are allowed; together they can never exceed the
 * original amount. The payment fee is not returned. Mobile money has no card-style refund
 * rail, so this is a wallet-to-wallet movement inside SurePesa.
 */
export async function refundPayment(input: RefundInput): Promise<Transaction> {
  assertPositive(input.amount);
  return prisma.$transaction(async (tx) => {
    // Lock the original so concurrent refunds cannot together exceed it.
    await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${input.transactionId}::uuid FOR UPDATE`;
    const original = await tx.transaction.findUnique({
      where: { id: input.transactionId },
      include: { refundedBy: { where: { status: 'SUCCESS' }, select: { amount: true } } },
    });
    if (!original) throw new AppError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404);
    if (original.type !== 'MERCHANT_PAYMENT' || original.status !== 'SUCCESS') {
      throw new AppError('NOT_REFUNDABLE', `A ${original.status} ${original.type} cannot be refunded`, 409);
    }
    const refunded = original.refundedBy.reduce((sum, r) => sum + r.amount, 0n);
    const remaining = original.amount - refunded;
    if (input.amount > remaining) {
      throw new AppError('REFUND_EXCEEDS_PAYMENT', 'Refund is larger than the amount left to refund', 409, {
        remaining: remaining.toString(),
      });
    }

    const refund = await tx.transaction.create({
      data: {
        reference: newTransactionReference(),
        type: 'REFUND',
        status: 'PROCESSING',
        initiatorUserId: input.actor.type === 'USER' ? input.actor.id : undefined,
        initiatorAdminId: input.actor.type === 'ADMIN' ? input.actor.id : undefined,
        sourceWalletId: original.destinationWalletId,
        destinationWalletId: original.sourceWalletId,
        amount: input.amount,
        currencyCode: original.currencyCode,
        refundsTransactionId: original.id,
        description: input.reason,
        events: { create: { toStatus: 'PROCESSING', actorType: input.actor.type, actorId: input.actor.id, note: input.reason } },
      },
    });

    // Throws PaymentRejectedError (rolling everything back) if the merchant lacks the funds.
    await postLedgerLines(tx, refund.id, [
      { walletId: original.destinationWalletId!, amount: -input.amount, entryType: 'PRINCIPAL' },
      { walletId: original.sourceWalletId!, amount: input.amount, entryType: 'PRINCIPAL' },
    ]);

    await tx.transactionEvent.create({
      data: {
        transactionId: original.id,
        fromStatus: original.status,
        toStatus: original.status,
        actorType: input.actor.type,
        actorId: input.actor.id,
        note: `Refunded ${input.amount} (${refund.reference}); ${remaining - input.amount} left`,
      },
    });
    if (input.actor.type === 'ADMIN') {
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: input.actor.id,
          action: 'TRANSACTION_REFUNDED',
          entityType: 'Transaction',
          entityId: original.id,
          after: { refundId: refund.id, amount: input.amount.toString(), reason: input.reason },
        },
      });
    }
    return transition(tx, refund, 'SUCCESS', input.actor);
  }, TX_OPTIONS);
}
