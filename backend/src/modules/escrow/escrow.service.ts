import { EscrowCase, EscrowStatus, Prisma } from '@prisma/client';
import { prisma, TX_OPTIONS } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { newEscrowReference, newTransactionReference } from '../../lib/reference';
import { postLedgerLines } from '../../services/ledger.service';
import { quoteFee } from '../../services/fee.service';
import { verifyPin } from '../../services/pin.service';
import { getOrCreateUserWallet, getSystemWallet, systemWalletCode } from '../../services/wallet.service';
import { EscrowActor, EscrowTerms, assertEscrowTransition, computeEscrowTermsHash, ESCROW_EXPIRABLE_STATES } from './escrow.state-machine';

/**
 * EscrowOrchestrator (blueprint §10): owns deal rules and calls the shared
 * payment/ledger services. Every funded deal gets a dedicated ESCROW_HOLDING wallet in
 * the central ledger (`ESCROW_CASE_<caseId>_<currency>`); its balance can never be
 * spent through ordinary wallet APIs, and only this module posts to it. Fees are
 * disclosed in the terms and recorded separately from the held principal.
 */

export const ESCROW_FUNDING_WINDOW_MS = 48 * 60 * 60_000; // 48 hours to fund

type Db = Prisma.TransactionClient | typeof prisma;

const escrowWalletCode = (caseId: string, currency: string) => `ESCROW_CASE_${caseId}_${currency}`;

function termsOf(c: EscrowCase): EscrowTerms {
  return {
    buyerId: c.buyerId,
    sellerId: c.sellerId,
    itemDescription: c.itemDescription,
    amount: c.amount,
    currencyCode: c.currencyCode,
    feeAmount: c.feeAmount,
    fundingDeadline: c.fundingDeadline.toISOString(),
    deliveryDeadline: c.deliveryDeadline?.toISOString() ?? null,
    inspectionDays: c.inspectionDays,
  };
}

async function loadCase(id: string): Promise<EscrowCase> {
  const row = await prisma.escrowCase.findUnique({ where: { id } });
  if (!row) throw new AppError('ESCROW_NOT_FOUND', 'Escrow case not found', 404);
  return row;
}

function assertParty(c: EscrowCase, userId: string): void {
  if (c.buyerId !== userId && c.sellerId !== userId) {
    throw new AppError('ESCROW_NOT_FOUND', 'Escrow case not found', 404); // no existence leak
  }
}

/** Moves a case between states with an optimistic concurrency guard + event log. */
async function transition(
  tx: Db,
  c: EscrowCase,
  to: EscrowStatus,
  actor: EscrowActor,
  actorId: string | null,
  note?: string,
  data?: Prisma.InputJsonValue,
  extra: Prisma.EscrowCaseUncheckedUpdateManyInput = {},
): Promise<EscrowCase> {
  assertEscrowTransition(c.status, to, actor);
  const result = await tx.escrowCase.updateMany({
    where: { id: c.id, status: c.status },
    data: { ...extra, status: to },
  });
  if (result.count !== 1) {
    throw new AppError('ESCROW_STATE_CHANGED', 'The escrow case changed state; refresh and try again', 409);
  }
  await tx.escrowEvent.create({
    data: {
      caseId: c.id,
      fromStatus: c.status,
      toStatus: to,
      actorType: actor === 'ADMIN' ? 'ADMIN' : actor === 'SYSTEM' ? 'SYSTEM' : 'USER',
      actorId,
      action: to,
      note,
      data,
    },
  });
  return tx.escrowCase.findUniqueOrThrow({ where: { id: c.id } });
}

async function expireIfNeeded(c: EscrowCase): Promise<EscrowCase> {
  if (c.fundingDeadline.getTime() <= Date.now() && ESCROW_EXPIRABLE_STATES.has(c.status)) {
    return prisma.$transaction((tx) => transition(tx, c, 'EXPIRED', 'SYSTEM', null, 'Funding deadline passed'), TX_OPTIONS);
  }
  return c;
}

// ─────────────────────── lifecycle ───────────────────────

export interface CreateEscrowInput {
  buyerId: string;
  sellerPhone: string; // E.164
  itemDescription: string;
  amount: bigint;
  currencyCode?: string;
  deliveryDays?: number;
  inspectionDays?: number;
  idempotencyKey: string;
}

/** Creates the deal (DRAFT -> AWAITING_COUNTERPARTY) and notifies the seller. */
export async function createEscrowCase(input: CreateEscrowInput): Promise<EscrowCase> {
  const buyer = await prisma.user.findUniqueOrThrow({ where: { id: input.buyerId } });
  if (buyer.status !== 'ACTIVE') throw new AppError('ACCOUNT_NOT_ACTIVE', 'Your account is not active', 403);

  const existing = await prisma.escrowCase.findUnique({
    where: { buyerId_idempotencyKey: { buyerId: input.buyerId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) return existing;

  const seller = await prisma.user.findUnique({ where: { phoneNumber: input.sellerPhone } });
  if (!seller || seller.status !== 'ACTIVE') {
    throw new AppError('SELLER_NOT_FOUND', 'No active SurePesa account uses this number', 404);
  }
  if (seller.id === buyer.id) throw new AppError('SELF_ESCROW', 'Buyer and seller must be different people', 422);

  const currency = input.currencyCode ?? 'TZS';
  const fee = await quoteFee('ESCROW_RELEASE', input.amount);
  const fundingDeadline = new Date(Date.now() + ESCROW_FUNDING_WINDOW_MS);
  const deliveryDays = input.deliveryDays ?? 7;
  const inspectionDays = input.inspectionDays ?? 3;

  const termsHash = computeEscrowTermsHash({
    buyerId: buyer.id,
    sellerId: seller.id,
    itemDescription: input.itemDescription,
    amount: input.amount,
    currencyCode: currency,
    feeAmount: fee,
    fundingDeadline: fundingDeadline.toISOString(),
    deliveryDeadline: null,
    inspectionDays,
  });

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.escrowCase.create({
        data: {
          reference: newEscrowReference(),
          buyerId: buyer.id,
          sellerId: seller.id,
          status: 'DRAFT',
          itemDescription: input.itemDescription,
          amount: input.amount,
          currencyCode: currency,
          feeAmount: fee,
          termsHash,
          fundingDeadline,
          deliveryDeadline: new Date(Date.now() + deliveryDays * 24 * 60 * 60_000),
          inspectionDays,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await tx.escrowEvent.create({
        data: { caseId: created.id, toStatus: 'DRAFT', actorType: 'USER', actorId: buyer.id, action: 'CREATED' },
      });
      const submitted = await transition(tx, created, 'AWAITING_COUNTERPARTY', 'BUYER', buyer.id, 'Terms sent to the seller');
      await tx.notification.create({
        data: {
          userId: seller.id,
          channel: 'IN_APP',
          title: 'Escrow deal offer',
          body: `${buyer.phoneNumber ?? 'A SurePesa user'} wants to buy with escrow protection: ${input.itemDescription}.`,
          data: { escrowCaseId: created.id, reference: created.reference },
        },
      });
      return submitted;
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const retry = await prisma.escrowCase.findUnique({
        where: { buyerId_idempotencyKey: { buyerId: input.buyerId, idempotencyKey: input.idempotencyKey } },
      });
      if (retry) return retry;
    }
    throw err;
  }
}

export async function listEscrowCases(userId: string, before?: Date, limit = 20) {
  return prisma.escrowCase.findMany({
    where: { OR: [{ buyerId: userId }, { sellerId: userId }], ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getEscrowCase(userId: string, id: string) {
  const c = await expireIfNeeded(await loadCase(id));
  assertParty(c, userId);
  return prisma.escrowCase.findUniqueOrThrow({
    where: { id: c.id },
    include: { evidence: true, disputes: true, payouts: true, events: { orderBy: { id: 'asc' } }, escrowWallet: true },
  });
}

/** Seller accepts the exact terms (hash-pinned); the deal opens for funding. */
export async function acceptTerms(sellerId: string, caseId: string): Promise<EscrowCase> {
  const c = await expireIfNeeded(await loadCase(caseId));
  if (c.sellerId !== sellerId) throw new AppError('ESCROW_NOT_FOUND', 'Escrow case not found', 404);
  return prisma.$transaction(async (tx) => {
    const accepted = await transition(tx, c, 'TERMS_ACCEPTED', 'SELLER', sellerId, `Terms accepted (${c.termsHash.slice(0, 12)}…)`);
    return transition(tx, accepted, 'AWAITING_FUNDING', 'SYSTEM', null, 'Awaiting buyer funding');
  }, TX_OPTIONS);
}

export async function declineTerms(sellerId: string, caseId: string): Promise<EscrowCase> {
  const c = await expireIfNeeded(await loadCase(caseId));
  if (c.sellerId !== sellerId) throw new AppError('ESCROW_NOT_FOUND', 'Escrow case not found', 404);
  return prisma.$transaction((tx) => transition(tx, c, 'DECLINED', 'SELLER', sellerId, 'Seller declined the terms', undefined, { closedAt: new Date() }), TX_OPTIONS);
}

export async function cancelCase(userId: string, caseId: string): Promise<EscrowCase> {
  const c = await expireIfNeeded(await loadCase(caseId));
  assertParty(c, userId);
  const actor: EscrowActor = c.buyerId === userId ? 'BUYER' : 'SELLER';
  if (actor === 'SELLER') throw new AppError('ESCROW_ILLEGAL_TRANSITION', 'A funded or open deal cannot be cancelled by the seller', 409);
  return prisma.$transaction((tx) => transition(tx, c, 'CANCELLED', actor, userId, 'Cancelled by the buyer', undefined, { closedAt: new Date() }), TX_OPTIONS);
}

/**
 * The buyer funds the deal: principal moves from the buyer's wallet into the deal's
 * dedicated ESCROW_HOLDING wallet (TransactionType ESCROW_HOLD). PIN required.
 */
export async function fundCase(buyerId: string, caseId: string, pin: string, idempotencyKey: string): Promise<EscrowCase> {
  const c = await expireIfNeeded(await loadCase(caseId));
  if (c.buyerId !== buyerId) throw new AppError('ESCROW_NOT_FOUND', 'Escrow case not found', 404);
  await verifyPin(buyerId, pin);

  const processing = await prisma.$transaction((tx) => transition(tx, c, 'FUNDING_PROCESSING', 'BUYER', buyerId, 'Buyer authorised funding'), TX_OPTIONS);

  try {
    const funded = await prisma.$transaction(async (tx) => {
      const buyerWallet = await getOrCreateUserWallet(tx, buyerId, processing.currencyCode);
      // One dedicated holding wallet per deal; allowNegative stays false.
      const escrowWallet = await tx.wallet.create({
        data: {
          kind: 'ESCROW_HOLDING',
          systemCode: escrowWalletCode(processing.id, processing.currencyCode),
          currencyCode: processing.currencyCode,
        },
      });
      const txn = await tx.transaction.create({
        data: {
          reference: newTransactionReference(),
          type: 'ESCROW_HOLD',
          status: 'PROCESSING',
          initiatorUserId: buyerId,
          idempotencyKey: `escrow-fund:${processing.id}:${idempotencyKey}`,
          sourceWalletId: buyerWallet.id,
          destinationWalletId: escrowWallet.id,
          amount: processing.amount,
          currencyCode: processing.currencyCode,
          description: `Escrow funding ${processing.reference}`,
          events: { create: { fromStatus: null, toStatus: 'PROCESSING', actorType: 'USER', actorId: buyerId } },
        },
      });
      await postLedgerLines(tx, txn.id, [
        { walletId: buyerWallet.id, amount: -processing.amount, entryType: 'ESCROW_HOLD' },
        { walletId: escrowWallet.id, amount: processing.amount, entryType: 'ESCROW_HOLD' },
      ]);
      await tx.transaction.update({
        where: { id: txn.id },
        data: { status: 'SUCCESS', completedAt: new Date(), events: { create: { fromStatus: 'PROCESSING', toStatus: 'SUCCESS', actorType: 'SYSTEM' } } },
      });
      return transition(tx, processing, 'FUNDED', 'SYSTEM', null, `Funds secured (${txn.reference})`, undefined, {
        escrowWalletId: escrowWallet.id,
        fundingTransactionId: txn.id,
        fundedAt: new Date(),
      });
    }, TX_OPTIONS);

    await prisma.notification.create({
      data: {
        userId: funded.sellerId,
        channel: 'IN_APP',
        title: 'Escrow funded',
        body: `Deal ${funded.reference} is funded and secured. You can now deliver.`,
        data: { escrowCaseId: funded.id },
      },
    });
    return funded;
  } catch (err) {
    await prisma
      .$transaction((tx) => transition(tx, processing, 'FUNDING_FAILED', 'SYSTEM', null, 'Funding failed'))
      .catch(() => null);
    throw err;
  }
}

/** Seller marks the deal as being fulfilled (shipped / service started). */
export async function markFulfilment(sellerId: string, caseId: string): Promise<EscrowCase> {
  const c = await loadCase(caseId);
  if (c.sellerId !== sellerId) throw new AppError('ESCROW_NOT_FOUND', 'Escrow case not found', 404);
  return prisma.$transaction((tx) => transition(tx, c, 'FULFILMENT_IN_PROGRESS', 'SELLER', sellerId, 'Fulfilment started'), TX_OPTIONS);
}

/** Either party attaches evidence (private object-storage key + checksum). */
export async function submitEvidence(
  userId: string,
  caseId: string,
  input: { type: 'PHOTO' | 'DOCUMENT' | 'TRACKING' | 'NOTE' | 'OTHER'; storageKey?: string; checksum?: string; note?: string },
) {
  const c = await loadCase(caseId);
  assertParty(c, userId);
  const evidence = await prisma.$transaction(async (tx) => {
    const ev = await tx.escrowEvidence.create({
      data: { caseId: c.id, submittedBy: userId, type: input.type, storageKey: input.storageKey, checksum: input.checksum, note: input.note },
    });
    await tx.escrowEvent.create({
      data: { caseId: c.id, actorType: 'USER', actorId: userId, action: 'EVIDENCE_SUBMITTED', data: { evidenceId: ev.id, type: input.type } },
    });
    return ev;
  }, TX_OPTIONS);
  return evidence;
}

/** Seller marks delivery done; the buyer's inspection window starts. */
export async function markDelivered(sellerId: string, caseId: string): Promise<EscrowCase> {
  const c = await loadCase(caseId);
  if (c.sellerId !== sellerId) throw new AppError('ESCROW_NOT_FOUND', 'Escrow case not found', 404);
  const updated = await prisma.$transaction((tx) =>
    transition(tx, c, 'AWAITING_BUYER_CONFIRMATION', 'SELLER', sellerId, 'Delivered; buyer inspection window open', undefined, { deliveredAt: new Date() }),
    TX_OPTIONS);
  await prisma.notification.create({
    data: {
      userId: updated.buyerId,
      channel: 'IN_APP',
      title: 'Escrow delivery',
      body: `Deal ${updated.reference} was marked delivered. Confirm receipt within ${updated.inspectionDays} days or open a dispute.`,
      data: { escrowCaseId: updated.id },
    },
  });
  return updated;
}

/**
 * Executes the single payout of a funded case. The escrow wallet is debited exactly
 * once; the fee (disclosed in the terms) goes to the fee wallet, the rest to the
 * destination user wallet. Runs inside one DB transaction with the state transition.
 */
async function executePayout(
  c: EscrowCase,
  kind: 'RELEASE' | 'REFUND',
  actor: EscrowActor,
  actorId: string | null,
  note: string,
): Promise<EscrowCase> {
  const destinationUserId = kind === 'RELEASE' ? c.sellerId : c.buyerId;
  const fee = kind === 'RELEASE' ? c.feeAmount : 0n; // refunds return the full principal
  const net = c.amount - fee;
  const entryType = kind === 'RELEASE' ? ('ESCROW_RELEASE' as const) : ('ESCROW_REFUND' as const);
  const finalStatus: EscrowStatus = kind === 'RELEASE' ? 'RELEASED' : 'REFUNDED';

  return prisma.$transaction(async (tx) => {
    // Exactly one payout per case per kind.
    const payout = await tx.escrowPayout.create({
      data: {
        caseId: c.id,
        kind,
        amount: net,
        feeAmount: fee,
        destinationUserId,
        idempotencyKey: `escrow-payout:${c.id}:${kind}`,
      },
    });
    const escrowWallet = await tx.wallet.findUniqueOrThrow({ where: { id: c.escrowWalletId! } });
    if (escrowWallet.kind !== 'ESCROW_HOLDING') throw new AppError('LEDGER_INVARIANT', 'Wallet is not an escrow holding wallet', 500);
    const destWallet = await getOrCreateUserWallet(tx, destinationUserId, c.currencyCode);
    const feeWallet = fee > 0n ? await getSystemWallet(tx, systemWalletCode.fees(c.currencyCode)) : null;

    const txn = await tx.transaction.create({
      data: {
        reference: newTransactionReference(),
        type: kind === 'RELEASE' ? 'ESCROW_RELEASE' : 'ESCROW_REFUND',
        status: 'PROCESSING',
        initiatorUserId: actor === 'ADMIN' ? undefined : actorId ?? undefined,
        initiatorAdminId: actor === 'ADMIN' ? actorId ?? undefined : undefined,
        idempotencyKey: `escrow-payout:${c.id}:${kind}`,
        sourceWalletId: escrowWallet.id,
        destinationWalletId: destWallet.id,
        amount: c.amount,
        currencyCode: c.currencyCode,
        fee,
        description: `Escrow ${kind === 'RELEASE' ? 'release' : 'refund'} ${c.reference}`,
        events: { create: { fromStatus: null, toStatus: 'PROCESSING', actorType: actor === 'ADMIN' ? 'ADMIN' : 'USER', actorId } },
      },
    });

    const posting: import('../../services/ledger.service').LedgerLine[] = [
      { walletId: escrowWallet.id, amount: -c.amount, entryType },
      { walletId: destWallet.id, amount: net, entryType },
    ];
    // Fees are separate from principal (blueprint §10 fee model): the escrow debit covers
    // the full principal; the credits are the destination's net plus the fee wallet's fee.
    if (fee > 0n && feeWallet) {
      posting.push({ walletId: feeWallet.id, amount: fee, entryType: 'FEE' });
    }
    await postLedgerLines(tx, txn.id, posting);
    await tx.transaction.update({
      where: { id: txn.id },
      data: { status: 'SUCCESS', completedAt: new Date(), events: { create: { fromStatus: 'PROCESSING', toStatus: 'SUCCESS', actorType: 'SYSTEM' } } },
    });
    await tx.escrowPayout.update({ where: { id: payout.id }, data: { status: 'SUCCESS', transactionId: txn.id } });

    return transition(tx, c, finalStatus, 'SYSTEM', actorId, note, undefined, {
      [kind === 'RELEASE' ? 'releasedAt' : 'refundedAt']: new Date(),
      closedAt: new Date(),
    });
  }, TX_OPTIONS);
}

/** Buyer confirms receipt: releases the held funds to the seller (minus the disclosed fee). */
export async function confirmReceipt(buyerId: string, caseId: string): Promise<EscrowCase> {
  const c = await loadCase(caseId);
  if (c.buyerId !== buyerId) throw new AppError('ESCROW_NOT_FOUND', 'Escrow case not found', 404);
  const pending = await prisma.$transaction(
    (tx) => transition(tx, c, 'RELEASE_PENDING', 'BUYER', buyerId, 'Buyer confirmed receipt'),
    TX_OPTIONS,
  );
  const released = await executePayout(pending, 'RELEASE', 'BUYER', buyerId, 'Released to the seller');
  await prisma.notification.create({
    data: {
      userId: released.sellerId,
      channel: 'IN_APP',
      title: 'Escrow released',
      body: `Deal ${released.reference} was paid out to your wallet.`,
      data: { escrowCaseId: released.id },
    },
  });
  return released;
}

/** Seller agrees to refund the buyer in full (e.g. cannot fulfil). */
export async function agreeRefund(sellerId: string, caseId: string): Promise<EscrowCase> {
  const c = await loadCase(caseId);
  if (c.sellerId !== sellerId) throw new AppError('ESCROW_NOT_FOUND', 'Escrow case not found', 404);
  const pending = await prisma.$transaction((tx) => transition(tx, c, 'REFUND_PENDING', 'SELLER', sellerId, 'Seller agreed to a refund'), TX_OPTIONS);
  return executePayout(pending, 'REFUND', 'SELLER', sellerId, 'Refunded to the buyer');
}

/** Either party opens a dispute; this freezes release until an authorised resolution. */
export async function openDispute(
  userId: string,
  caseId: string,
  input: { reason: string; requestedOutcome: 'RELEASE_TO_SELLER' | 'REFUND_BUYER' },
) {
  const c = await loadCase(caseId);
  assertParty(c, userId);
  const open = await prisma.escrowDispute.findFirst({ where: { caseId: c.id, status: { in: ['OPEN', 'UNDER_REVIEW'] } } });
  if (open) throw new AppError('DISPUTE_EXISTS', 'This deal already has an open dispute', 409);

  return prisma.$transaction(async (tx) => {
    const dispute = await tx.escrowDispute.create({
      data: { caseId: c.id, openedById: userId, reason: input.reason, requestedOutcome: input.requestedOutcome },
    });
    await transition(tx, c, 'DISPUTED', c.buyerId === userId ? 'BUYER' : 'SELLER', userId, `Dispute opened: ${input.reason}`);
    return dispute;
  }, TX_OPTIONS);
}

/**
 * Authorised dispute resolution (admin only): releases to the seller or refunds the
 * buyer, with a full audit trail. Disputes never auto-resolve.
 */
export async function resolveDispute(
  adminId: string,
  disputeId: string,
  input: { outcome: 'RELEASE_TO_SELLER' | 'REFUND_BUYER'; note: string },
): Promise<EscrowCase> {
  const dispute = await prisma.escrowDispute.findUnique({ where: { id: disputeId } });
  if (!dispute) throw new AppError('DISPUTE_NOT_FOUND', 'Dispute not found', 404);
  if (dispute.status === 'RESOLVED') throw new AppError('DISPUTE_RESOLVED', 'This dispute is already resolved', 409);

  const c = await loadCase(dispute.caseId);
  const target: EscrowStatus = input.outcome === 'RELEASE_TO_SELLER' ? 'RELEASE_PENDING' : 'REFUND_PENDING';

  const pending = await prisma.$transaction(async (tx) => {
    await tx.escrowDispute.update({
      where: { id: dispute.id },
      data: { status: 'RESOLVED', resolution: input.outcome, resolvedById: adminId, resolutionNote: input.note, resolvedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorType: 'ADMIN',
        actorId: adminId,
        action: `ESCROW_DISPUTE_${input.outcome}`,
        entityType: 'EscrowCase',
        entityId: c.id,
        after: { disputeId: dispute.id, note: input.note },
      },
    });
    return transition(tx, c, target, 'ADMIN', adminId, `Dispute resolved: ${input.outcome}`);
  }, TX_OPTIONS);

  return executePayout(pending, input.outcome === 'RELEASE_TO_SELLER' ? 'RELEASE' : 'REFUND', 'ADMIN', adminId, `Dispute resolution payout (${input.outcome})`);
}

/** Read-only held/available state of a deal's escrow wallet. No spend endpoint exists. */
export async function getEscrowWalletSummary(userId: string, caseId: string) {
  const c = await getEscrowCase(userId, caseId);
  if (!c.escrowWallet) return { funded: false, heldMinor: '0', currencyCode: c.currencyCode };
  return {
    funded: true,
    heldMinor: c.escrowWallet.balance.toString(),
    currencyCode: c.currencyCode,
    status: c.escrowWallet.status,
    systemCode: c.escrowWallet.systemCode,
  };
}

/** Funding-deadline sweep for the scheduled job. Funded cases never expire. */
export async function expireOverdueCases(now = new Date()): Promise<number> {
  const overdue = await prisma.escrowCase.findMany({
    where: { status: { in: [...ESCROW_EXPIRABLE_STATES] as EscrowStatus[] }, fundingDeadline: { lt: now } },
  });
  let count = 0;
  for (const c of overdue) {
    await prisma.$transaction((tx) => transition(tx, c, 'EXPIRED', 'SYSTEM', null, 'Funding deadline passed'), TX_OPTIONS)
      .then(() => count++)
      .catch(() => null);
  }
  return count;
}

/**
 * Reconciles internal escrow liabilities (SUM of ESCROW_HOLDING wallet balances in a
 * currency) against the declared custody statement total. Any difference must be 0.
 */
export async function reconcileEscrowCustody(custodyAccountId: string, statementTotal: bigint, reviewerId?: string) {
  const account = await prisma.escrowCustodyAccount.findUniqueOrThrow({ where: { id: custodyAccountId } });
  const held = await prisma.wallet.aggregate({
    where: { kind: 'ESCROW_HOLDING', currencyCode: account.currencyCode },
    _sum: { balance: true },
  });
  const internalTotal = held._sum.balance ?? 0n;
  return prisma.escrowReconciliation.create({
    data: {
      custodyAccountId,
      statementTotal,
      internalHeldTotal: internalTotal,
      difference: statementTotal - internalTotal,
      reviewedById: reviewerId,
      reviewedAt: reviewerId ? new Date() : null,
    },
  });
}
