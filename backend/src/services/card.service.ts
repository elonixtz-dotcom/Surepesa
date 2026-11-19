import { Prisma, Transaction, VirtualCard, Wallet } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, PaymentRejectedError } from '../lib/errors';
import { defaultCardIssuer, getCardIssuer } from '../providers';
import { CardEvent, RevealedCard } from '../providers/card-issuer';
import { quoteFee } from './fee.service';
import {
  Actor,
  assertCanSend,
  assertPositive,
  loadUser,
  openTransaction,
  reverseTransaction,
  run,
  settle,
  SYSTEM,
  transferLines,
} from './payment.service';
import { getOrCreateUserWallet, getSystemWallet, systemWalletCode } from './wallet.service';
import { registeredName } from './receipt.service';

/**
 * Prepaid virtual cards, SimBanking style: the customer creates a card in the app, loads it
 * from their SurePesa wallet and uses it online. Each card has its own CARD wallet in the
 * same double-entry ledger; purchases are authorised in real time against that balance.
 *
 *   load      user wallet  -> card wallet            CARD_LOAD
 *   unload    card wallet  -> user wallet            CARD_UNLOAD
 *   purchase  card wallet  -> issuer float           CARD_PURCHASE (approve/decline in real time)
 *   reversal  purchase undone by the issuer          REVERSAL of the purchase
 *   refund    issuer float -> card wallet            CARD_REFUND
 *
 * PCI: no card number or CVV is ever stored or logged; see providers/card-issuer.ts.
 */

export const MAX_OPEN_CARDS = 3;
export const REVEALS_PER_HOUR = 5;
const OPEN: VirtualCard['status'][] = ['REQUESTED', 'ACTIVE', 'FROZEN'];

type Db = Prisma.TransactionClient | typeof prisma;

// ───────────────────────── Wallets ─────────────────────────

async function cardWallet(db: Db, cardId: string): Promise<Wallet> {
  const w = await db.wallet.findUnique({ where: { cardId } });
  if (!w) throw new AppError('CARD_WALLET_MISSING', 'Card has no balance account', 500);
  return w;
}

/** Mirror of money owed to the card network for an issuer; created on first use. */
async function issuerFloat(db: Db, issuer: string, currency: string): Promise<Wallet> {
  const code = systemWalletCode.float(currency, `CARD_${issuer}`);
  try {
    return await db.wallet.upsert({
      where: { systemCode: code },
      update: {},
      create: { kind: 'SYSTEM_FLOAT', systemCode: code, currencyCode: currency, allowNegative: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return getSystemWallet(db, code);
    throw err;
  }
}

export async function loadOwnCard(userId: string, cardId: string): Promise<VirtualCard> {
  const card = await prisma.virtualCard.findUnique({ where: { id: cardId } });
  if (!card || card.userId !== userId) throw new AppError('CARD_NOT_FOUND', 'Card not found', 404);
  return card;
}

// ───────────────────────── Lifecycle ─────────────────────────

export interface CreateCardInput {
  userId: string;
  nickname: string;
  validityMonths?: 6 | 12 | 24;
  perTransactionLimit?: bigint | null;
}

/** Issues a new virtual card. The caller has already checked the user's PIN. */
export async function createCard(input: CreateCardInput): Promise<VirtualCard> {
  const user = await loadUser(input.userId);
  assertCanSend(user); // active and identity-verified, like any money movement
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
  const open = await prisma.virtualCard.count({ where: { userId: user.id, status: { in: OPEN } } });
  if (open >= MAX_OPEN_CARDS) {
    throw new PaymentRejectedError('TOO_MANY_CARDS', `You can have up to ${MAX_OPEN_CARDS} cards. Close one to create another.`);
  }

  const issuer = defaultCardIssuer();
  const card = await prisma.virtualCard.create({
    data: {
      userId: user.id,
      issuerName: issuer.name,
      nickname: input.nickname,
      validityMonths: input.validityMonths ?? 24,
      perTransactionLimit: input.perTransactionLimit ?? null,
      wallet: { create: { kind: 'CARD', currencyCode: 'TZS' } },
    },
  });

  let issued;
  try {
    issued = await issuer.issueCard({
      reference: card.id,
      holderName: registeredName(profile) ?? 'SUREPESA CARDHOLDER',
      phoneNumber: user.phoneNumber ?? '',
      email: user.email,
      currency: card.currencyCode,
      validityMonths: card.validityMonths as 6 | 12 | 24,
    });
  } catch {
    // Unknown outcome: the issuer may have created it. Stay REQUESTED; refreshCard() resolves it.
    return prisma.virtualCard.update({ where: { id: card.id }, data: { failureReason: 'Waiting for the issuer' } });
  }

  const updated = await prisma.virtualCard.update({
    where: { id: card.id },
    data: {
      status: issued.status === 'ACTIVE' ? 'ACTIVE' : issued.status === 'FAILED' ? 'FAILED' : 'REQUESTED',
      issuerCardId: issued.issuerCardId,
      brand: issued.brand,
      last4: issued.last4,
      expiryMonth: issued.expiryMonth,
      expiryYear: issued.expiryYear,
      failureReason: issued.failureReason ?? null,
    },
  });
  if (updated.status === 'FAILED') {
    await prisma.wallet.update({ where: { cardId: card.id }, data: { status: 'CLOSED' } });
  } else if (updated.status === 'ACTIVE' && input.perTransactionLimit != null) {
    await issuer.setLimit(updated.issuerCardId!, input.perTransactionLimit);
  }
  return updated;
}

/** Asks the issuer about a card that is still REQUESTED. */
export async function refreshCard(userId: string, cardId: string): Promise<VirtualCard> {
  const card = await loadOwnCard(userId, cardId);
  if (card.status !== 'REQUESTED' || !card.issuerCardId) return card;
  const s = await getCardIssuer(card.issuerName).cardStatus(card.issuerCardId);
  if (s.status === 'PENDING') return card;
  return prisma.virtualCard.update({
    where: { id: card.id },
    data: { status: s.status === 'ACTIVE' ? 'ACTIVE' : 'FAILED', last4: s.last4 ?? card.last4, brand: s.brand ?? card.brand, failureReason: s.failureReason ?? null },
  });
}

export async function freezeCard(userId: string, cardId: string, frozen: boolean): Promise<VirtualCard> {
  const card = await loadOwnCard(userId, cardId);
  if (card.status !== (frozen ? 'ACTIVE' : 'FROZEN')) {
    throw new AppError('CARD_STATE', frozen ? 'Only an active card can be frozen' : 'This card is not frozen', 409);
  }
  await getCardIssuer(card.issuerName).setStatus(card.issuerCardId!, frozen ? 'BLOCKED' : 'ACTIVE');
  return prisma.virtualCard.update({
    where: { id: card.id },
    data: { status: frozen ? 'FROZEN' : 'ACTIVE', frozenAt: frozen ? new Date() : null },
  });
}

export async function setCardLimit(userId: string, cardId: string, perTransaction: bigint | null): Promise<VirtualCard> {
  const card = await loadOwnCard(userId, cardId);
  if (!['ACTIVE', 'FROZEN'].includes(card.status)) throw new AppError('CARD_STATE', 'This card cannot be changed', 409);
  if (perTransaction !== null) assertPositive(perTransaction);
  await getCardIssuer(card.issuerName).setLimit(card.issuerCardId!, perTransaction);
  return prisma.virtualCard.update({ where: { id: card.id }, data: { perTransactionLimit: perTransaction } });
}

/**
 * Terminates the card at the issuer first (so nothing more can be spent), then returns the
 * remaining balance to the user's wallet.
 */
export async function closeCard(userId: string, cardId: string): Promise<VirtualCard> {
  const card = await loadOwnCard(userId, cardId);
  if (card.status === 'CLOSED') return card;
  if (card.issuerCardId && card.status !== 'FAILED') {
    await getCardIssuer(card.issuerName).setStatus(card.issuerCardId, 'TERMINATED');
  }
  const closing = await prisma.virtualCard.update({ where: { id: card.id }, data: { status: 'CLOSED', closedAt: new Date() } });
  const wallet = await cardWallet(prisma, card.id);
  if (wallet.balance > 0n) {
    const swept = await moveBetweenWalletAndCard('CARD_UNLOAD', userId, closing, wallet.balance, `close:${card.id}`, true);
    if (swept.status !== 'SUCCESS') throw new AppError('CARD_SWEEP_FAILED', 'Card closed, but its balance could not be returned yet', 500);
  }
  await prisma.wallet.update({ where: { id: wallet.id }, data: { status: 'CLOSED' } });
  return closing;
}

// ───────────────────────── Funding ─────────────────────────

export async function loadCard(userId: string, cardId: string, amount: bigint, idempotencyKey: string): Promise<Transaction> {
  const card = await loadOwnCard(userId, cardId);
  if (!['ACTIVE', 'FROZEN'].includes(card.status)) throw new PaymentRejectedError('CARD_NOT_ACTIVE', 'This card cannot be loaded');
  assertCanSend(await loadUser(userId));
  return moveBetweenWalletAndCard('CARD_LOAD', userId, card, amount, idempotencyKey);
}

export async function unloadCard(userId: string, cardId: string, amount: bigint, idempotencyKey: string): Promise<Transaction> {
  const card = await loadOwnCard(userId, cardId);
  if (!['ACTIVE', 'FROZEN'].includes(card.status)) throw new PaymentRejectedError('CARD_NOT_ACTIVE', 'This card cannot be unloaded');
  return moveBetweenWalletAndCard('CARD_UNLOAD', userId, card, amount, idempotencyKey);
}

async function moveBetweenWalletAndCard(
  type: 'CARD_LOAD' | 'CARD_UNLOAD',
  userId: string,
  card: VirtualCard,
  amount: bigint,
  idempotencyKey: string,
  closing = false,
): Promise<Transaction> {
  assertPositive(amount);
  const [user, cw] = await Promise.all([getOrCreateUserWallet(prisma, userId, card.currencyCode), cardWallet(prisma, card.id)]);
  if (cw.status === 'CLOSED' && !closing) throw new PaymentRejectedError('CARD_NOT_ACTIVE', 'This card is closed');
  const [source, destination] = type === 'CARD_LOAD' ? [user, cw] : [cw, user];
  const fee = type === 'CARD_LOAD' ? await quoteFee('CARD_LOAD', amount) : 0n;
  const actor: Actor = { type: 'USER', id: userId };
  const label = `${card.brand} •••• ${card.last4 ?? '----'} (${card.nickname})`;

  const opened = await openTransaction(
    {
      type,
      initiatorUserId: userId,
      idempotencyKey,
      sourceWalletId: source.id,
      destinationWalletId: destination.id,
      amount,
      currencyCode: card.currencyCode,
      fee,
      description: type === 'CARD_LOAD' ? `Loaded ${label}` : `From ${label}`,
      metadata: { cardId: card.id },
    },
    actor,
  );
  return run(opened, (txn) =>
    settle(
      txn,
      async (tx) => transferLines(source.id, destination.id, txn.amount, txn.fee, (await getSystemWallet(tx, systemWalletCode.fees(card.currencyCode))).id),
      actor,
    ),
  );
}

// ───────────────────────── Card details ─────────────────────────

/**
 * One-time display of the card number and CVV (or delivery by the issuer). The caller has
 * already checked the PIN. Rate-limited and audited; the details themselves are never stored.
 */
export async function revealCard(userId: string, cardId: string, ipAddress?: string): Promise<RevealedCard> {
  const card = await loadOwnCard(userId, cardId);
  if (!['ACTIVE', 'FROZEN'].includes(card.status) || !card.issuerCardId) {
    throw new AppError('CARD_STATE', 'Details are only available for an issued card', 409);
  }
  const recent = await prisma.auditLog.count({
    where: { action: 'CARD_DETAILS_REVEALED', entityId: card.id, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
  });
  if (recent >= REVEALS_PER_HOUR) {
    throw new AppError('TOO_MANY_REVEALS', 'You have viewed this card too often. Try again in an hour.', 429);
  }
  const revealed = await getCardIssuer(card.issuerName).revealCard(card.issuerCardId);
  await prisma.auditLog.create({
    data: { actorType: 'USER', actorId: userId, action: 'CARD_DETAILS_REVEALED', entityType: 'VirtualCard', entityId: card.id, after: { kind: revealed.kind }, ipAddress },
  });
  // The issuer may not know our stored expiry; ours is authoritative for display.
  return revealed.kind === 'DETAILS' && card.expiryMonth && card.expiryYear
    ? { ...revealed, expiryMonth: card.expiryMonth, expiryYear: card.expiryYear }
    : revealed;
}

// ───────────────────────── Issuer events ─────────────────────────

export interface CardDecision {
  decision: 'APPROVED' | 'DECLINED';
  reason?: string;
  transactionReference?: string;
}

const declined = (reason: string): CardDecision => ({ decision: 'DECLINED', reason });

/**
 * Applies a verified issuer event. Idempotent: a redelivered event returns the decision that
 * was given the first time, without charging again.
 */
export async function handleCardEvent(issuerName: string, ev: CardEvent): Promise<CardDecision> {
  const card = await prisma.virtualCard.findUnique({ where: { issuerName_issuerCardId: { issuerName, issuerCardId: ev.issuerCardId } } });

  let stored;
  try {
    stored = await prisma.cardEvent.create({
      data: {
        issuerName,
        eventId: ev.eventId,
        cardId: card?.id,
        kind: ev.kind,
        authId: ev.authId,
        amount: ev.amount,
        currencyCode: ev.currency,
        merchantName: ev.merchantName,
        payload: { ...ev, amount: ev.amount.toString() } as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    const existing = await prisma.cardEvent.findUniqueOrThrow({ where: { issuerName_eventId: { issuerName, eventId: ev.eventId } } });
    if (existing.processedAt && existing.decision) {
      return { decision: existing.decision as CardDecision['decision'], reason: existing.declineReason ?? undefined };
    }
    stored = existing;
  }

  const result = !card ? declined('UNKNOWN_CARD') : await decide(card, ev);
  const txn = result.transactionReference
    ? await prisma.transaction.findUnique({ where: { reference: result.transactionReference }, select: { id: true } })
    : null;
  await prisma.cardEvent.update({
    where: { id: stored.id },
    data: { decision: result.decision, declineReason: result.reason, transactionId: txn?.id, processedAt: new Date() },
  });
  return result;
}

const purchaseKey = (issuer: string, authId: string) => `card:${issuer}:auth:${authId}`;

async function decide(card: VirtualCard, ev: CardEvent): Promise<CardDecision> {
  if (ev.currency !== card.currencyCode) return declined('CURRENCY_NOT_SUPPORTED');
  assertPositive(ev.amount);

  if (ev.kind === 'AUTHORIZATION') {
    if (card.status === 'FROZEN') return declined('CARD_FROZEN');
    if (card.status !== 'ACTIVE') return declined('CARD_NOT_ACTIVE');
    if (card.expiryYear && card.expiryMonth && new Date(card.expiryYear, card.expiryMonth, 1) <= new Date()) return declined('CARD_EXPIRED');
    if (card.perTransactionLimit !== null && ev.amount > card.perTransactionLimit) return declined('OVER_CARD_LIMIT');

    const [cw, float] = await Promise.all([cardWallet(prisma, card.id), issuerFloat(prisma, card.issuerName, card.currencyCode)]);
    const opened = await openTransaction(
      {
        type: 'CARD_PURCHASE',
        initiatorUserId: card.userId,
        idempotencyKey: purchaseKey(card.issuerName, ev.authId),
        sourceWalletId: cw.id,
        destinationWalletId: float.id,
        amount: ev.amount,
        currencyCode: card.currencyCode,
        description: ev.merchantName ?? 'Card purchase',
        providerName: card.issuerName,
        metadata: { cardId: card.id, authId: ev.authId, merchantName: ev.merchantName ?? null, merchantCountry: ev.merchantCountry ?? null },
      },
      SYSTEM,
    );
    const txn = await run(opened, (t) => settle(t, async () => transferLines(cw.id, float.id, t.amount, 0n, float.id), SYSTEM));
    return txn.status === 'SUCCESS'
      ? { decision: 'APPROVED', transactionReference: txn.reference }
      : { decision: 'DECLINED', reason: txn.failureCode ?? 'DECLINED', transactionReference: txn.reference };
  }

  const purchase = await prisma.transaction.findUnique({
    where: { initiatorUserId_idempotencyKey: { initiatorUserId: card.userId, idempotencyKey: purchaseKey(card.issuerName, ev.authId) } },
    include: { refundedBy: { where: { status: 'SUCCESS' }, select: { amount: true } } },
  });
  if (!purchase || purchase.type !== 'CARD_PURCHASE') return declined('UNKNOWN_AUTHORIZATION');

  if (ev.kind === 'REVERSAL') {
    if (purchase.status === 'REVERSED') return { decision: 'APPROVED', transactionReference: purchase.reference };
    if (purchase.status !== 'SUCCESS') return declined('NOT_REVERSIBLE');
    try {
      const reversal = await reverseTransaction(purchase.id, { actor: SYSTEM, reason: `Reversed by ${card.issuerName}: ${purchase.description ?? 'card purchase'}` });
      return { decision: 'APPROVED', transactionReference: reversal.reference };
    } catch (err) {
      if (err instanceof AppError && err.code === 'ALREADY_REVERSED') return { decision: 'APPROVED', transactionReference: purchase.reference };
      throw err;
    }
  }

  // REFUND: a merchant gives money back to the card, up to what was spent.
  const refunded = purchase.refundedBy.reduce((s, r) => s + r.amount, 0n);
  if (purchase.status !== 'SUCCESS' || refunded + ev.amount > purchase.amount) return declined('REFUND_EXCEEDS_PURCHASE');
  const [cw, float] = await Promise.all([cardWallet(prisma, card.id), issuerFloat(prisma, card.issuerName, card.currencyCode)]);
  const opened = await openTransaction(
    {
      type: 'CARD_REFUND',
      initiatorUserId: card.userId,
      idempotencyKey: `card:${card.issuerName}:refund:${ev.eventId}`,
      sourceWalletId: float.id,
      destinationWalletId: cw.id,
      amount: ev.amount,
      currencyCode: card.currencyCode,
      description: `Refund: ${ev.merchantName ?? purchase.description ?? 'card purchase'}`,
      providerName: card.issuerName,
      metadata: { cardId: card.id, authId: ev.authId, merchantName: ev.merchantName ?? purchase.description },
    },
    SYSTEM,
  );
  const txn = await run(opened, async (t) => {
    const done = await settle(t, async () => transferLines(float.id, cw.id, t.amount, 0n, float.id), SYSTEM);
    // Link the refund to its purchase so later refunds are capped correctly.
    return prisma.transaction.update({ where: { id: done.id }, data: { refundsTransactionId: purchase.id } });
  });
  return { decision: 'APPROVED', transactionReference: txn.reference };
}

/** Card balance plus the fields the app shows. Never includes the card number or CVV. */
export async function presentCard(card: VirtualCard, db: Db = prisma) {
  const w = await db.wallet.findUnique({ where: { cardId: card.id } });
  return {
    id: card.id,
    nickname: card.nickname,
    status: card.status,
    brand: card.brand,
    last4: card.last4,
    expiry: card.expiryMonth && card.expiryYear ? `${String(card.expiryMonth).padStart(2, '0')}/${String(card.expiryYear).slice(-2)}` : null,
    currency: card.currencyCode,
    balanceMinor: w?.balance ?? 0n,
    perTransactionLimitMinor: card.perTransactionLimit,
    failureReason: card.failureReason,
    createdAt: card.createdAt,
    frozenAt: card.frozenAt,
    closedAt: card.closedAt,
  };
}

