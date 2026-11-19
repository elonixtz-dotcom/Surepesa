import { Prisma, PushBillSession, PushBillState } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError, PaymentRejectedError } from '../../lib/errors';
import { newPushBillReference } from '../../lib/reference';
import { verifyPin } from '../../services/pin.service';
import { payMerchant } from '../../services/payment.service';
import { getVoiceCarrier, simulatedVoiceCarrier } from '../../providers';
import { VoiceCallEvent, VoiceCarrier } from '../../providers/voice-carrier';
import {
  assertTermsUnchanged,
  assertTransition,
  computeTermsHash,
  PUSH_BILL_EXPIRABLE_STATES,
  PushBillActor,
  PushBillTerms,
} from './pushbill.state-machine';

/**
 * PushBillOrchestrator (blueprint §6): destination validation, payer binding, session
 * expiry, voice-call coordination, explicit confirmations and payer authorisation.
 *
 * The session itself never moves money. The one payment happens in authorise(), through the
 * shared payment service, only after: a completed bridged call, both parties' explicit
 * confirmations, and the payer's PIN. Money-in-flight states never expire silently and an
 * unknown provider outcome is reconciled, not retried.
 */
export const PUSH_BILL_SESSION_TTL_MS = 30 * 60_000;

export interface CreatePushBillInput {
  requesterId: string;
  destinationKind: 'QR_CODE' | 'MERCHANT_CODE' | 'AGENT_NUMBER';
  /** Scanned QR token, or the manually entered Lipa Namba / merchant code / agent number. */
  destination: string;
  payerPhone: string; // E.164 +255...
  amount: bigint; // minor units
  note?: string;
  idempotencyKey: string;
}

interface ResolvedDestination {
  businessId: string;
  qrCodeId?: string;
  label: string;
}

// ─────────────────────── helpers ───────────────────────

function termsOf(session: PushBillSession): PushBillTerms {
  return {
    destinationKind: session.destinationKind,
    destination: session.businessId ?? session.destinationInput,
    amount: session.amount,
    currencyCode: session.currencyCode,
  };
}

async function resolveDestination(
  kind: CreatePushBillInput['destinationKind'],
  input: string,
): Promise<ResolvedDestination> {
  if (kind === 'QR_CODE') {
    const qr = await prisma.qrCode.findUnique({ where: { token: input }, include: { business: true } });
    if (!qr || !qr.isActive || !qr.business.isActive) {
      throw new AppError('DESTINATION_NOT_FOUND', 'This QR code is not a registered SurePesa destination', 404);
    }
    return { businessId: qr.businessId, qrCodeId: qr.id, label: qr.business.tradingName };
  }
  if (kind === 'MERCHANT_CODE') {
    const business = await prisma.business.findUnique({ where: { merchantCode: input.toUpperCase() } });
    if (!business || !business.isActive) {
      throw new AppError('DESTINATION_NOT_FOUND', 'No active merchant uses this Lipa Namba', 404);
    }
    return { businessId: business.id, label: business.tradingName };
  }
  const business = await prisma.business.findFirst({ where: { phoneNumber: input, isActive: true } });
  if (!business) {
    throw new AppError('DESTINATION_NOT_FOUND', 'No active SurePesa agent uses this number', 404);
  }
  return { businessId: business.id, label: business.tradingName };
}

/**
 * Moves a session from its current state, recording the event, with an optimistic
 * concurrency guard: two racing transitions cannot both win.
 */
async function transition(
  sessionId: string,
  from: PushBillState,
  to: PushBillState,
  actor: PushBillActor,
  actorId: string | null,
  note?: string,
  data?: Prisma.InputJsonValue,
): Promise<PushBillSession> {
  assertTransition(from, to, actor);
  const [session] = await prisma.$transaction([
    prisma.pushBillSession.updateMany({ where: { id: sessionId, state: from }, data: { state: to } }),
    prisma.pushBillEvent.create({
      data: { sessionId, fromState: from, toState: to, actorType: actor === 'ADMIN' ? 'ADMIN' : actor === 'SYSTEM' || actor === 'VOICE_PROVIDER' ? 'SYSTEM' : 'USER', actorId, note, data },
    }),
  ]);
  if (session.count !== 1) {
    throw new AppError('PUSHBILL_STATE_CHANGED', 'The PushBill request changed state; refresh and try again', 409);
  }
  return prisma.pushBillSession.findUniqueOrThrow({ where: { id: sessionId } });
}

async function loadSession(id: string): Promise<PushBillSession> {
  const session = await prisma.pushBillSession.findUnique({ where: { id } });
  if (!session) throw new AppError('PUSHBILL_NOT_FOUND', 'PushBill request not found', 404);
  return session;
}

function assertParticipant(session: PushBillSession, userId: string): void {
  if (session.requesterId !== userId && session.payerId !== userId) {
    throw new AppError('PUSHBILL_NOT_FOUND', 'PushBill request not found', 404); // no existence leak
  }
}

async function expireIfNeeded(session: PushBillSession): Promise<PushBillSession> {
  if (session.expiresAt.getTime() <= Date.now() && PUSH_BILL_EXPIRABLE_STATES.has(session.state)) {
    return transition(session.id, session.state, 'EXPIRED', 'SYSTEM', null, 'Session expired');
  }
  return session;
}

// ─────────────────────── lifecycle ───────────────────────

/**
 * Creates a one-time, expiring PushBill session: resolves and verifies the destination,
 * binds the payer, pins the terms hash, and notifies the payer. Lands in PAYER_NOTIFIED.
 */
export async function createPushBill(input: CreatePushBillInput): Promise<PushBillSession> {
  const requester = await prisma.user.findUniqueOrThrow({ where: { id: input.requesterId } });
  if (requester.status !== 'ACTIVE') throw new AppError('ACCOUNT_NOT_ACTIVE', 'Your account is not active', 403);

  // A retried create with the same key returns the same session instead of a duplicate.
  const existing = await prisma.pushBillSession.findUnique({
    where: { requesterId_idempotencyKey: { requesterId: input.requesterId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) return existing;

  const destination = await resolveDestination(input.destinationKind, input.destination);

  const payer = await prisma.user.findUnique({ where: { phoneNumber: input.payerPhone } });
  if (!payer || payer.status !== 'ACTIVE') {
    throw new AppError('PAYER_NOT_FOUND', 'No active SurePesa account uses this number', 404);
  }
  if (payer.id === requester.id) throw new AppError('SELF_PUSHBILL', 'You cannot ask yourself to pay', 422);
  if (!payer.phoneNumber) throw new AppError('PAYER_NOT_REACHABLE', 'The payer has no verified phone number', 422);
  if (!requester.phoneNumber) throw new AppError('REQUESTER_NOT_REACHABLE', 'Verify your phone number first', 422);

  const now = new Date();
  const base = {
    requesterId: requester.id,
    payerId: payer.id,
    destinationKind: input.destinationKind,
    destinationInput: input.destination,
    destinationLabel: destination.label,
    businessId: destination.businessId,
    qrCodeId: destination.qrCodeId,
    amount: input.amount,
    note: input.note,
    idempotencyKey: input.idempotencyKey,
    expiresAt: new Date(now.getTime() + PUSH_BILL_SESSION_TTL_MS),
  };
  const termsHash = computeTermsHash({
    destinationKind: input.destinationKind,
    destination: destination.businessId,
    amount: input.amount,
    currencyCode: 'TZS',
  });

  try {
    return await prisma.$transaction(async (tx) => {
      const session = await tx.pushBillSession.create({
        data: { ...base, reference: newPushBillReference(), state: 'CREATED', termsHash },
      });
      await tx.pushBillEvent.create({
        data: { sessionId: session.id, fromState: 'CREATED', toState: 'DESTINATION_VERIFIED', actorType: 'SYSTEM', note: `Destination verified: ${destination.label}` },
      });
      await tx.pushBillEvent.create({
        data: { sessionId: session.id, fromState: 'DESTINATION_VERIFIED', toState: 'PAYER_SELECTED', actorType: 'USER', actorId: requester.id, note: 'Payer selected' },
      });
      await tx.pushBillEvent.create({
        data: { sessionId: session.id, fromState: 'PAYER_SELECTED', toState: 'PAYER_NOTIFIED', actorType: 'SYSTEM', note: 'Payer notified' },
      });
      const updated = await tx.pushBillSession.update({
        where: { id: session.id },
        data: { state: 'PAYER_NOTIFIED' },
      });
      await tx.notification.create({
        data: {
          userId: payer.id,
          channel: 'IN_APP',
          title: 'Payment request',
          body: `${requester.phoneNumber} asks you to pay ${destination.label}. You will confirm on a normal phone call first.`,
          data: { pushBillSessionId: session.id, reference: session.reference },
        },
      });
      return updated;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const retry = await prisma.pushBillSession.findUnique({
        where: { requesterId_idempotencyKey: { requesterId: input.requesterId, idempotencyKey: input.idempotencyKey } },
      });
      if (retry) return retry;
    }
    throw err;
  }
}

export async function listPushBills(userId: string, before?: Date, limit = 20): Promise<PushBillSession[]> {
  return prisma.pushBillSession.findMany({
    where: {
      OR: [{ requesterId: userId }, { payerId: userId }],
      ...(before ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getPushBill(userId: string, id: string): Promise<PushBillSession> {
  const session = await loadSession(id);
  assertParticipant(session, userId);
  return expireIfNeeded(session);
}

/** Payer agrees to proceed: the request moves to CALL_REQUESTED, ready for the bridge. */
export async function acceptPushBill(payerId: string, sessionId: string): Promise<PushBillSession> {
  let session = await expireIfNeeded(await loadSession(sessionId));
  if (session.payerId !== payerId) throw new AppError('PUSHBILL_NOT_FOUND', 'PushBill request not found', 404);
  return transition(session.id, session.state, 'CALL_REQUESTED', 'PAYER', payerId, 'Payer accepted');
}

export async function declinePushBill(payerId: string, sessionId: string): Promise<PushBillSession> {
  const session = await expireIfNeeded(await loadSession(sessionId));
  if (session.payerId !== payerId) throw new AppError('PUSHBILL_NOT_FOUND', 'PushBill request not found', 404);
  return transition(session.id, session.state, 'DECLINED', 'PAYER', payerId, 'Payer declined');
}

export async function cancelPushBill(requesterId: string, sessionId: string): Promise<PushBillSession> {
  const session = await expireIfNeeded(await loadSession(sessionId));
  if (session.requesterId !== requesterId) throw new AppError('PUSHBILL_NOT_FOUND', 'PushBill request not found', 404);
  return transition(session.id, session.state, 'CANCELLED', 'REQUESTER', requesterId, 'Requester cancelled');
}

/**
 * Starts the bridged cellular call through the voice carrier. The carrier's webhooks drive
 * the session from here: connected, no-answer, failed. The USSD session, if any, must already
 * be closed before this point (blueprint §6 USSD rule).
 */
export async function requestCall(
  userId: string,
  sessionId: string,
  carrierName = simulatedVoiceCarrier.name,
): Promise<{ session: PushBillSession; providerCallId: string }> {
  let session = await expireIfNeeded(await loadSession(sessionId));
  assertParticipant(session, userId);
  const actor: PushBillActor = session.payerId === userId ? 'PAYER' : 'REQUESTER';

  const [requester, payer] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: session.requesterId } }),
    prisma.user.findUniqueOrThrow({ where: { id: session.payerId! } }),
  ]);
  if (!requester.phoneNumber || !payer.phoneNumber) {
    throw new AppError('CALL_NOT_POSSIBLE', 'Both parties need a verified phone number for the call', 422);
  }

  // accept() may already have moved the session to CALL_REQUESTED; only transition if needed.
  if (session.state !== 'CALL_REQUESTED') {
    session = await transition(session.id, session.state, 'CALL_REQUESTED', actor, userId, 'Call requested');
  }

  const carrier: VoiceCarrier = getVoiceCarrier(carrierName);
  try {
    const bridge = await carrier.startBridge({
      sessionReference: session.reference,
      requesterPhone: requester.phoneNumber,
      payerPhone: payer.phoneNumber,
    });
    await prisma.voiceCallAttempt.create({
      data: {
        sessionId: session.id,
        provider: carrier.name,
        providerCallId: bridge.providerCallId,
        status: 'REQUESTED',
      },
    });
    session = await transition(session.id, 'CALL_REQUESTED', 'CALLING', 'VOICE_PROVIDER', null, 'Carrier is ringing both parties');
    return { session, providerCallId: bridge.providerCallId };
  } catch (err) {
    await transition(session.id, 'CALL_REQUESTED', 'CALL_FAILED', 'SYSTEM', null, 'Carrier refused the call').catch(() => null);
    throw err;
  }
}

/**
 * Records one party's explicit confirmation of the details discussed on the call. When both
 * parties have confirmed, the session advances to AWAITING_PAYER_AUTH. A mismatch or
 * rejection ends the request — no payment.
 */
export async function confirmPushBill(
  userId: string,
  sessionId: string,
  method: 'IN_APP' | 'USSD',
  result: 'CONFIRMED' | 'REJECTED' | 'MISMATCH',
): Promise<PushBillSession> {
  const session = await expireIfNeeded(await loadSession(sessionId));
  assertParticipant(session, userId);
  if (session.state !== 'CALL_CONNECTED') {
    throw new AppError('PUSHBILL_ILLEGAL_TRANSITION', 'Confirmations are only taken while the call is connected', 409);
  }
  const role = session.requesterId === userId ? 'REQUESTER' : 'PAYER';
  const detailsHash = computeTermsHash(termsOf(session));

  await prisma.pushBillConfirmation.create({
    data: { sessionId: session.id, userId, role, method, detailsHash, result },
  });

  if (result !== 'CONFIRMED') {
    return transition(session.id, 'CALL_CONNECTED', 'MISMATCH', role, userId, `Party reported ${result.toLowerCase()}`);
  }

  const confirmed = await prisma.pushBillConfirmation.findMany({
    where: { sessionId: session.id, result: 'CONFIRMED' },
    select: { role: true },
  });
  const roles = new Set(confirmed.map((c) => c.role));
  if (!roles.has('REQUESTER') || !roles.has('PAYER')) return session;

  const both = await transition(session.id, 'CALL_CONNECTED', 'BOTH_PARTIES_CONFIRMED', 'SYSTEM', null, 'Both parties confirmed the details');
  return transition(session.id, 'BOTH_PARTIES_CONFIRMED', 'AWAITING_PAYER_AUTH', 'SYSTEM', null, 'Awaiting payer authorisation');
}

/**
 * The only point where money can move. Requires: session in AWAITING_PAYER_AUTH, unchanged
 * terms, the payer's PIN. The payment runs through the shared payment service and reuses its
 * idempotency, ledger and receipt machinery.
 */
export async function authorisePushBill(
  payerId: string,
  sessionId: string,
  pin: string,
  idempotencyKey: string,
): Promise<PushBillSession> {
  const session = await expireIfNeeded(await loadSession(sessionId));
  if (session.payerId !== payerId) throw new AppError('PUSHBILL_NOT_FOUND', 'PushBill request not found', 404);
  assertTermsUnchanged(session.termsHash!, termsOf(session));
  await verifyPin(payerId, pin);

  const processing = await transition(session.id, session.state, 'PAYMENT_PROCESSING', 'PAYER', payerId, 'Payer authorised');

  try {
    const txn = await payMerchant({
      payerUserId: payerId,
      businessId: session.businessId!,
      amount: session.amount,
      idempotencyKey: `pushbill:${session.id}:${idempotencyKey}`,
      qrCodeId: session.qrCodeId ?? undefined,
      description: `PushBill ${session.reference}${session.note ? ` — ${session.note}` : ''}`,
    });
    await transition(session.id, 'PAYMENT_PROCESSING', 'PAID', 'SYSTEM', null, `Payment verified: ${txn.reference}`);
    return prisma.pushBillSession.update({
      where: { id: session.id },
      data: { paymentTransactionId: txn.id },
    });
  } catch (err) {
    if (err instanceof PaymentRejectedError) {
      await transition(session.id, 'PAYMENT_PROCESSING', 'PAYMENT_FAILED', 'SYSTEM', null, err.message).catch(() => null);
    } else {
      // Uncertain outcome: reconcile before any retry; never pay twice.
      await transition(session.id, 'PAYMENT_PROCESSING', 'PAYMENT_UNKNOWN', 'SYSTEM', null, 'Payment outcome uncertain').catch(() => null);
    }
    throw err;
  }
}

/** Expiry sweep for the scheduled job. Money-in-flight states are never swept. */
export async function expireOverdueSessions(now = new Date()): Promise<number> {
  const overdue = await prisma.pushBillSession.findMany({
    where: { state: { in: [...PUSH_BILL_EXPIRABLE_STATES] as PushBillState[] }, expiresAt: { lt: now } },
    select: { id: true, state: true },
  });
  let count = 0;
  for (const s of overdue) {
    await transition(s.id, s.state, 'EXPIRED', 'SYSTEM', null, 'Session expired')
      .then(() => count++)
      .catch(() => null);
  }
  return count;
}

// ─────────────────────── voice webhooks ───────────────────────

const VOICE_EVENT_TO_ATTEMPT_STATUS: Record<VoiceCallEvent['status'], string> = {
  RINGING: 'RINGING',
  CONNECTED: 'CONNECTED',
  COMPLETED: 'COMPLETED',
  NO_ANSWER: 'NO_ANSWER',
  BUSY: 'NO_ANSWER',
  FAILED: 'FAILED',
};

/**
 * Applies a verified voice-carrier event. Idempotent per event id; unknown calls are
 * reported, not created. An answered/connected call advances the session but is never by
 * itself payment consent.
 */
export async function handleVoiceEvent(
  carrier: VoiceCarrier,
  event: VoiceCallEvent,
): Promise<{ outcome: string }> {
  const attempt = await prisma.voiceCallAttempt.findUnique({
    where: { provider_providerCallId: { provider: carrier.name, providerCallId: event.providerCallId } },
    include: { session: true },
  });
  if (!attempt) return { outcome: 'UNKNOWN_CALL' };
  if (attempt.lastEventId === event.eventId) return { outcome: 'ALREADY_APPLIED' };

  await prisma.voiceCallAttempt.update({
    where: { id: attempt.id },
    data: {
      status: VOICE_EVENT_TO_ATTEMPT_STATUS[event.status] as never,
      lastEventId: event.eventId,
      failureCode: event.failureCode,
      ...(event.status === 'CONNECTED' ? { connectedAt: new Date() } : {}),
      ...(event.status === 'COMPLETED' || event.status === 'FAILED' ? { endedAt: new Date() } : {}),
    },
  });

  const session = attempt.session;
  switch (event.status) {
    case 'CONNECTED':
      if (session.state === 'CALLING') {
        await transition(session.id, 'CALLING', 'CALL_CONNECTED', 'VOICE_PROVIDER', null, 'Call connected').catch(() => null);
      }
      break;
    case 'NO_ANSWER':
    case 'BUSY':
      if (session.state === 'CALLING' || session.state === 'CALL_REQUESTED') {
        await transition(session.id, session.state, 'NO_ANSWER', 'VOICE_PROVIDER', null, 'No answer').catch(() => null);
      }
      break;
    case 'FAILED':
      if (session.state === 'CALLING' || session.state === 'CALL_REQUESTED' || session.state === 'CALL_CONNECTED') {
        await transition(session.id, session.state, 'CALL_FAILED', 'VOICE_PROVIDER', null, event.failureReason ?? 'Call failed').catch(() => null);
      }
      break;
    default:
      break; // RINGING and COMPLETED only update the attempt
  }
  return { outcome: 'APPLIED' };
}
