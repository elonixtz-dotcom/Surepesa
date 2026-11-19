import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  assertTermsUnchanged,
  assertTransition,
  canTransition,
  computeTermsHash,
  isTerminalState,
  PUSH_BILL_EXPIRABLE_STATES,
  PUSH_BILL_STATES,
  PUSH_BILL_TERMINAL_STATES,
  type PushBillActor,
  type PushBillStateName,
} from '../src/modules/pushbill/pushbill.state-machine';

const HAPPY_PATH: Array<[PushBillStateName, PushBillStateName, PushBillActor]> = [
  ['CREATED', 'DESTINATION_VERIFIED', 'SYSTEM'],
  ['DESTINATION_VERIFIED', 'PAYER_SELECTED', 'REQUESTER'],
  ['PAYER_SELECTED', 'PAYER_NOTIFIED', 'SYSTEM'],
  ['PAYER_NOTIFIED', 'CALL_REQUESTED', 'SYSTEM'],
  ['CALL_REQUESTED', 'CALLING', 'VOICE_PROVIDER'],
  ['CALLING', 'CALL_CONNECTED', 'VOICE_PROVIDER'],
  ['CALL_CONNECTED', 'BOTH_PARTIES_CONFIRMED', 'SYSTEM'],
  ['BOTH_PARTIES_CONFIRMED', 'AWAITING_PAYER_AUTH', 'SYSTEM'],
  ['AWAITING_PAYER_AUTH', 'PAYMENT_PROCESSING', 'PAYER'],
  ['PAYMENT_PROCESSING', 'PAID', 'SYSTEM'],
];

describe('pushbill state machine', () => {
  it('walks the full happy path to PAID', () => {
    for (const [from, to, actor] of HAPPY_PATH) {
      expect(canTransition(from, to, actor), `${from} -> ${to}`).toBe(true);
      expect(() => assertTransition(from, to, actor)).not.toThrow();
    }
  });

  it('every declared state appears in the transition table', () => {
    for (const state of PUSH_BILL_STATES) {
      expect(() => allowedTransitions(state)).not.toThrow();
    }
  });

  it('rejects skipping straight to payment', () => {
    expect(canTransition('CREATED', 'PAID', 'SYSTEM')).toBe(false);
    expect(canTransition('CALL_CONNECTED', 'PAYMENT_PROCESSING', 'PAYER')).toBe(false);
    expect(canTransition('AWAITING_PAYER_AUTH', 'PAID', 'PAYER')).toBe(false);
  });

  it('an answered call alone never authorises payment', () => {
    // CALL_CONNECTED cannot jump past explicit confirmations and payer authorisation.
    expect(allowedTransitions('CALL_CONNECTED')).not.toContain('PAYMENT_PROCESSING');
    expect(allowedTransitions('CALL_CONNECTED')).not.toContain('PAID');
    expect(allowedTransitions('CALLING')).not.toContain('AWAITING_PAYER_AUTH');
  });

  it('only the payer authorises or declines', () => {
    expect(canTransition('AWAITING_PAYER_AUTH', 'PAYMENT_PROCESSING', 'PAYER')).toBe(true);
    expect(canTransition('AWAITING_PAYER_AUTH', 'PAYMENT_PROCESSING', 'REQUESTER')).toBe(false);
    expect(canTransition('AWAITING_PAYER_AUTH', 'PAYMENT_PROCESSING', 'SYSTEM')).toBe(false);
    expect(canTransition('PAYER_NOTIFIED', 'DECLINED', 'REQUESTER')).toBe(false);
  });

  it('terminal states have no outgoing transitions', () => {
    for (const state of PUSH_BILL_TERMINAL_STATES) {
      expect(isTerminalState(state)).toBe(true);
      expect(allowedTransitions(state)).toEqual([]);
    }
    expect(() => assertTransition('PAID', 'PAYMENT_PROCESSING', 'SYSTEM')).toThrowError(/cannot go from PAID/);
  });

  it('a payment whose outcome is unknown is reconciled, never blindly retried', () => {
    expect(canTransition('PAYMENT_PROCESSING', 'PAYMENT_UNKNOWN', 'SYSTEM')).toBe(true);
    // No path back into processing from UNKNOWN — that would risk a duplicate payment.
    expect(canTransition('PAYMENT_UNKNOWN', 'PAYMENT_PROCESSING', 'SYSTEM')).toBe(false);
    expect(canTransition('PAYMENT_UNKNOWN', 'PAID', 'SYSTEM')).toBe(true);
    expect(canTransition('PAYMENT_UNKNOWN', 'REVIEW_REQUIRED', 'ADMIN')).toBe(true);
  });

  it('sessions never expire while money may be moving', () => {
    expect(PUSH_BILL_EXPIRABLE_STATES.has('PAYMENT_PROCESSING')).toBe(false);
    expect(PUSH_BILL_EXPIRABLE_STATES.has('PAYMENT_UNKNOWN')).toBe(false);
    expect(PUSH_BILL_EXPIRABLE_STATES.has('AWAITING_PAYER_AUTH')).toBe(true);
    // ...and no expirable state is terminal.
    for (const state of PUSH_BILL_EXPIRABLE_STATES) {
      expect(isTerminalState(state)).toBe(false);
    }
  });

  it('expires pre-payment sessions and refuses post-payment expiry', () => {
    expect(canTransition('CALLING', 'EXPIRED', 'SYSTEM')).toBe(true);
    expect(canTransition('PAYMENT_PROCESSING', 'EXPIRED', 'SYSTEM')).toBe(false);
  });
});

describe('pushbill terms binding', () => {
  const terms = {
    destinationKind: 'QR_CODE',
    destination: 'biz_123',
    amount: 25_000_00n,
    currencyCode: 'TZS',
  };

  it('is stable for identical terms', () => {
    expect(computeTermsHash(terms)).toBe(computeTermsHash({ ...terms }));
  });

  it('rejects a changed amount or destination after payer approval', () => {
    const hash = computeTermsHash(terms);
    expect(() => assertTermsUnchanged(hash, { ...terms })).not.toThrow();
    expect(() => assertTermsUnchanged(hash, { ...terms, amount: terms.amount + 100n }))
      .toThrowError(/changed after payer approval/);
    expect(() => assertTermsUnchanged(hash, { ...terms, destination: 'biz_999' }))
      .toThrowError(/changed after payer approval/);
    expect(() => assertTermsUnchanged(hash, { ...terms, currencyCode: 'KES' }))
      .toThrowError(/changed after payer approval/);
  });
});
