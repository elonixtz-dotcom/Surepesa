import { createHash } from 'node:crypto';
import { AppError } from '../../lib/errors';

/**
 * PushBill ★ state machine (blueprint §6).
 *
 * A requester at a merchant/agent asks another SurePesa user to pay. The flow REQUIRES an
 * ordinary cellular voice call between the parties before payment authorisation:
 *
 *   CREATED -> DESTINATION_VERIFIED -> PAYER_SELECTED -> PAYER_NOTIFIED
 *     -> CALL_REQUESTED -> CALLING -> CALL_CONNECTED -> BOTH_PARTIES_CONFIRMED
 *     -> AWAITING_PAYER_AUTH -> PAYMENT_PROCESSING -> PAID
 *
 * No answer / decline / mismatch / expiry means NO payment authorisation. An answered call
 * is not by itself consent: the payer must still explicitly authorise the exact payment
 * afterwards (app or a fresh USSD session). A PIN is never spoken or collected on the call.
 */
export const PUSH_BILL_STATES = [
  'CREATED',
  'DESTINATION_VERIFIED',
  'PAYER_SELECTED',
  'PAYER_NOTIFIED',
  'CALL_REQUESTED',
  'CALLING',
  'CALL_CONNECTED',
  'BOTH_PARTIES_CONFIRMED',
  'AWAITING_PAYER_AUTH',
  'PAYMENT_PROCESSING',
  'PAID',
  'DECLINED',
  'NO_ANSWER',
  'CALL_FAILED',
  'MISMATCH',
  'EXPIRED',
  'CANCELLED',
  'PAYMENT_FAILED',
  'PAYMENT_UNKNOWN',
  'REVIEW_REQUIRED',
] as const;

export type PushBillStateName = (typeof PUSH_BILL_STATES)[number];

/** Who drives a transition. USER roles are checked against the session's requester/payer. */
export type PushBillActor = 'REQUESTER' | 'PAYER' | 'SYSTEM' | 'VOICE_PROVIDER' | 'ADMIN';

/** States with no outgoing transition. */
export const PUSH_BILL_TERMINAL_STATES: ReadonlySet<PushBillStateName> = new Set([
  'PAID',
  'DECLINED',
  'NO_ANSWER',
  'CALL_FAILED',
  'MISMATCH',
  'EXPIRED',
  'CANCELLED',
  'PAYMENT_FAILED',
]);

/**
 * States the expiry job may sweep to EXPIRED. Payment-in-flight states are excluded: once
 * money may be moving (PAYMENT_PROCESSING / PAYMENT_UNKNOWN), the session must never expire
 * silently — the provider outcome is reconciled first.
 */
export const PUSH_BILL_EXPIRABLE_STATES: ReadonlySet<PushBillStateName> = new Set([
  'CREATED',
  'DESTINATION_VERIFIED',
  'PAYER_SELECTED',
  'PAYER_NOTIFIED',
  'CALL_REQUESTED',
  'CALLING',
  'CALL_CONNECTED',
  'BOTH_PARTIES_CONFIRMED',
  'AWAITING_PAYER_AUTH',
]);

const TRANSITIONS: Readonly<Record<PushBillStateName, ReadonlyMap<PushBillStateName, readonly PushBillActor[]>>> = {
  CREATED: new Map([
    ['DESTINATION_VERIFIED', ['SYSTEM']], // server resolved the merchant/agent destination
    ['CANCELLED', ['REQUESTER']],
    ['EXPIRED', ['SYSTEM']],
  ]),
  DESTINATION_VERIFIED: new Map([
    ['PAYER_SELECTED', ['REQUESTER']],
    ['CANCELLED', ['REQUESTER']],
    ['EXPIRED', ['SYSTEM']],
  ]),
  PAYER_SELECTED: new Map([
    ['PAYER_NOTIFIED', ['SYSTEM']],
    ['CANCELLED', ['REQUESTER']],
    ['EXPIRED', ['SYSTEM']],
  ]),
  PAYER_NOTIFIED: new Map([
    ['CALL_REQUESTED', ['REQUESTER', 'PAYER', 'SYSTEM']],
    ['DECLINED', ['PAYER']],
    ['CANCELLED', ['REQUESTER']],
    ['EXPIRED', ['SYSTEM']],
  ]),
  CALL_REQUESTED: new Map([
    ['CALLING', ['VOICE_PROVIDER']],
    ['CALL_FAILED', ['VOICE_PROVIDER', 'SYSTEM']],
    ['CANCELLED', ['REQUESTER', 'PAYER']],
    ['EXPIRED', ['SYSTEM']],
  ]),
  CALLING: new Map([
    ['CALL_CONNECTED', ['VOICE_PROVIDER']],
    ['NO_ANSWER', ['VOICE_PROVIDER']],
    ['CALL_FAILED', ['VOICE_PROVIDER', 'SYSTEM']],
    ['CANCELLED', ['REQUESTER', 'PAYER']],
    ['EXPIRED', ['SYSTEM']],
  ]),
  CALL_CONNECTED: new Map([
    ['BOTH_PARTIES_CONFIRMED', ['SYSTEM']], // both PushBillConfirmations verified
    ['MISMATCH', ['REQUESTER', 'PAYER', 'SYSTEM']], // parties confirmed different details
    ['CALL_FAILED', ['VOICE_PROVIDER', 'SYSTEM']], // call dropped mid-conversation
    ['EXPIRED', ['SYSTEM']],
  ]),
  BOTH_PARTIES_CONFIRMED: new Map([
    ['AWAITING_PAYER_AUTH', ['SYSTEM']], // call ended cleanly; payer authorises next
    ['EXPIRED', ['SYSTEM']],
  ]),
  AWAITING_PAYER_AUTH: new Map([
    ['PAYMENT_PROCESSING', ['PAYER']], // explicit PIN/biometric/USSD authorisation
    ['DECLINED', ['PAYER']],
    ['CANCELLED', ['REQUESTER']],
    ['EXPIRED', ['SYSTEM']],
  ]),
  PAYMENT_PROCESSING: new Map([
    ['PAID', ['SYSTEM']], // provider success verified
    ['PAYMENT_FAILED', ['SYSTEM']],
    ['PAYMENT_UNKNOWN', ['SYSTEM']], // uncertain provider outcome: reconcile, never blind-retry
  ]),
  PAYMENT_UNKNOWN: new Map([
    ['PAID', ['SYSTEM']], // reconciliation found the payment succeeded
    ['PAYMENT_FAILED', ['SYSTEM']], // reconciliation proved it never happened
    ['REVIEW_REQUIRED', ['SYSTEM', 'ADMIN']],
  ]),
  REVIEW_REQUIRED: new Map([
    ['PAID', ['ADMIN']],
    ['PAYMENT_FAILED', ['ADMIN']],
  ]),
  PAID: new Map(),
  DECLINED: new Map(),
  NO_ANSWER: new Map(),
  CALL_FAILED: new Map(),
  MISMATCH: new Map(),
  EXPIRED: new Map(),
  CANCELLED: new Map(),
  PAYMENT_FAILED: new Map(),
};

export function isTerminalState(state: PushBillStateName): boolean {
  return PUSH_BILL_TERMINAL_STATES.has(state);
}

export function allowedTransitions(state: PushBillStateName): readonly PushBillStateName[] {
  return [...(TRANSITIONS[state]?.keys() ?? [])];
}

export function canTransition(
  from: PushBillStateName,
  to: PushBillStateName,
  actor: PushBillActor,
): boolean {
  return TRANSITIONS[from]?.get(to)?.includes(actor) ?? false;
}

/** Throws PUSHBILL_ILLEGAL_TRANSITION unless `actor` may move the session from -> to. */
export function assertTransition(
  from: PushBillStateName,
  to: PushBillStateName,
  actor: PushBillActor,
): void {
  if (!canTransition(from, to, actor)) {
    throw new AppError(
      'PUSHBILL_ILLEGAL_TRANSITION',
      `PushBill session cannot go from ${from} to ${to} (actor: ${actor})`,
      409,
    );
  }
}

export interface PushBillTerms {
  destinationKind: string;
  /** Resolved destination identity: business id, QR token or normalised merchant/agent number. */
  destination: string;
  amount: bigint;
  currencyCode: string;
}

/**
 * Pins the approved amount + destination to the session. The hash is stored at payer
 * approval; afterwards any change to these terms is rejected (blueprint §6: "reject any
 * mutation after payer approval").
 */
export function computeTermsHash(terms: PushBillTerms): string {
  return createHash('sha256')
    .update(
      [
        terms.destinationKind,
        terms.destination,
        terms.amount.toString(),
        terms.currencyCode,
      ].join('|'),
    )
    .digest('hex');
}

/** Throws PUSHBILL_TERMS_CHANGED when the live terms no longer match the approved hash. */
export function assertTermsUnchanged(approvedTermsHash: string, current: PushBillTerms): void {
  if (computeTermsHash(current) !== approvedTermsHash) {
    throw new AppError(
      'PUSHBILL_TERMS_CHANGED',
      'The destination or amount changed after payer approval; start a new request',
      409,
    );
  }
}
