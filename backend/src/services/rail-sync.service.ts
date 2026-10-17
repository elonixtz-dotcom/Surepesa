import { Prisma, Transaction } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getProvider } from '../providers';
import { ProviderCallback, ProviderResult } from '../providers/payment-provider';
import { applyRailOutcome, RAIL_RECHECK_MS, RailOutcome } from './payment.service';

/**
 * Resolves deposits and withdrawals whose rail has not given a final answer yet.
 *
 * Two paths lead here, and both end in payment.service `applyRailOutcome`, which is
 * idempotent and row-locked:
 *  - callbacks (webhooks) pushed by the rail: `handleProviderCallback`
 *  - polling the rail for anything still open: `syncRails` (callbacks get lost)
 */

/** A rail transaction left PROCESSING with no schedule (e.g. the API crashed mid-call) is picked up after this. */
const ORPHAN_AFTER_MS = 5 * 60_000;

export interface SyncSummary {
  checked: number;
  applied: number;
  waiting: number;
  escalated: number;
  errors: number;
}

export async function syncRails(limit = 50): Promise<SyncSummary> {
  const now = new Date();
  const due = await prisma.transaction.findMany({
    where: {
      status: 'PROCESSING',
      type: { in: ['DEPOSIT', 'WITHDRAWAL'] },
      escalatedAt: null,
      OR: [
        { nextRailCheckAt: { lte: now } },
        { nextRailCheckAt: null, updatedAt: { lt: new Date(now.getTime() - ORPHAN_AFTER_MS) } },
      ],
    },
    include: { paymentMethod: true },
    orderBy: { nextRailCheckAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
  });

  const summary: SyncSummary = { checked: 0, applied: 0, waiting: 0, escalated: 0, errors: 0 };
  for (const txn of due) {
    // Claim the row: only the poller that moves next_rail_check_at forward queries the rail.
    const claimed = await prisma.transaction.updateMany({
      where: { id: txn.id, status: 'PROCESSING', nextRailCheckAt: txn.nextRailCheckAt },
      data: { nextRailCheckAt: new Date(Date.now() + RAIL_RECHECK_MS) },
    });
    if (!claimed.count) continue;

    summary.checked++;
    try {
      const outcome = await checkRailNow(txn);
      if (outcome === 'APPLIED') summary.applied++;
      else if (outcome === 'ESCALATED') summary.escalated++;
      else if (outcome === 'NOT_FINAL') summary.waiting++;
    } catch (err) {
      summary.errors++;
      console.error(`rail-sync: ${txn.reference} failed`, err);
    }
  }
  return summary;
}

/** Queries the rail for one transaction immediately and applies the answer. */
export async function checkRailNow(
  txn: Transaction & { paymentMethod: { accountNumber: string; provider: string } | null },
): Promise<RailOutcome> {
  if (!txn.paymentMethod) throw new Error(`Transaction ${txn.reference} has no payment method`);
  const provider = getProvider(txn.providerName ?? txn.paymentMethod.provider);
  let result: ProviderResult;
  try {
    result = await provider.queryStatus({
      kind: txn.type === 'DEPOSIT' ? 'COLLECTION' : 'PAYOUT',
      reference: txn.reference,
      providerReference: txn.providerReference,
      accountNumber: txn.paymentMethod.accountNumber,
    });
  } catch (err) {
    result = { status: 'AMBIGUOUS', failureReason: err instanceof Error ? err.message : 'Status query failed' };
  }
  return (await applyRailOutcome(txn.id, result, 'status query')).outcome;
}

export type CallbackOutcome = RailOutcome | 'DUPLICATE' | 'UNKNOWN_TRANSACTION';

/**
 * Stores a verified callback in the provider_events inbox, then applies it.
 * A redelivery of an event that was already processed is acknowledged and ignored; one whose
 * earlier processing never finished is processed again.
 */
export async function handleProviderCallback(providerName: string, cb: ProviderCallback): Promise<CallbackOutcome> {
  const txn = await findCallbackTransaction(providerName, cb);

  let event;
  try {
    event = await prisma.providerEvent.create({
      data: {
        providerName,
        eventId: cb.eventId,
        transactionId: txn?.id,
        status: cb.status,
        payload: cb as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    const existing = await prisma.providerEvent.findUniqueOrThrow({
      where: { providerName_eventId: { providerName, eventId: cb.eventId } },
    });
    if (existing.processedAt) return 'DUPLICATE';
    event = existing;
  }

  let outcome: CallbackOutcome;
  if (!txn) {
    // Acknowledge so the rail stops retrying; the stored event is there for Finance to match.
    outcome = 'UNKNOWN_TRANSACTION';
  } else {
    outcome = (
      await applyRailOutcome(
        txn.id,
        { status: cb.status, providerReference: cb.providerReference, failureCode: cb.failureCode, failureReason: cb.failureReason },
        'callback',
      )
    ).outcome;
  }
  await prisma.providerEvent.update({ where: { id: event.id }, data: { outcome, processedAt: new Date() } });
  return outcome;
}

/** Matches a callback to our transaction. A provider can only ever settle its own transactions. */
async function findCallbackTransaction(providerName: string, cb: ProviderCallback) {
  const txn = cb.reference
    ? await prisma.transaction.findUnique({ where: { reference: cb.reference } })
    : cb.providerReference
      ? await prisma.transaction.findUnique({
          where: { providerName_providerReference: { providerName, providerReference: cb.providerReference } },
        })
      : null;
  if (!txn || txn.providerName !== providerName) return null;
  if (cb.providerReference && txn.providerReference && txn.providerReference !== cb.providerReference) return null;
  return txn;
}
