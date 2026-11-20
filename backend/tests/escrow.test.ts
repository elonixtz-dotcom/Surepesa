import { describe, expect, it } from 'vitest';
import {
  assertEscrowTransition,
  computeEscrowTermsHash,
  EscrowTerms,
} from '../src/modules/escrow/escrow.state-machine';

const terms: EscrowTerms = {
  buyerId: 'b',
  sellerId: 's',
  itemDescription: 'Laptop',
  amount: 100000n,
  currencyCode: 'TZS',
  feeAmount: 1000n,
  fundingDeadline: '2026-11-20T00:00:00.000Z',
  deliveryDeadline: null,
  inspectionDays: 3,
};

describe('escrow state machine (blueprint §10)', () => {
  it('walks the happy path in order', () => {
    expect(() => assertEscrowTransition('DRAFT', 'AWAITING_COUNTERPARTY', 'BUYER')).not.toThrow();
    expect(() => assertEscrowTransition('AWAITING_COUNTERPARTY', 'TERMS_ACCEPTED', 'SELLER')).not.toThrow();
    expect(() => assertEscrowTransition('TERMS_ACCEPTED', 'AWAITING_FUNDING', 'SYSTEM')).not.toThrow();
    expect(() => assertEscrowTransition('AWAITING_FUNDING', 'FUNDING_PROCESSING', 'BUYER')).not.toThrow();
    expect(() => assertEscrowTransition('FUNDING_PROCESSING', 'FUNDED', 'SYSTEM')).not.toThrow();
    expect(() => assertEscrowTransition('FUNDED', 'FULFILMENT_IN_PROGRESS', 'SELLER')).not.toThrow();
    expect(() => assertEscrowTransition('FULFILMENT_IN_PROGRESS', 'AWAITING_BUYER_CONFIRMATION', 'SELLER')).not.toThrow();
    expect(() => assertEscrowTransition('AWAITING_BUYER_CONFIRMATION', 'RELEASE_PENDING', 'BUYER')).not.toThrow();
    expect(() => assertEscrowTransition('RELEASE_PENDING', 'RELEASED', 'SYSTEM')).not.toThrow();
  });

  it('blocks illegal jumps and wrong actors', () => {
    expect(() => assertEscrowTransition('DRAFT', 'FUNDED', 'BUYER')).toThrowError(/cannot move/);
    expect(() => assertEscrowTransition('AWAITING_COUNTERPARTY', 'TERMS_ACCEPTED', 'BUYER')).toThrowError(/cannot move/);
    expect(() => assertEscrowTransition('DISPUTED', 'RELEASED', 'BUYER')).toThrowError(/cannot move/);
    expect(() => assertEscrowTransition('FUNDED', 'RELEASED', 'SYSTEM')).toThrowError(/cannot move/);
    expect(() => assertEscrowTransition('RELEASED', 'REFUNDED', 'ADMIN')).toThrowError(/cannot move/);
  });

  it('disputes pause payouts; only an admin decision resumes them', () => {
    expect(() => assertEscrowTransition('AWAITING_BUYER_CONFIRMATION', 'DISPUTED', 'BUYER')).not.toThrow();
    expect(() => assertEscrowTransition('DISPUTED', 'RELEASE_PENDING', 'ADMIN')).not.toThrow();
    expect(() => assertEscrowTransition('DISPUTED', 'REFUND_PENDING', 'ADMIN')).not.toThrow();
    expect(() => assertEscrowTransition('DISPUTED', 'RELEASED', 'SYSTEM')).toThrowError(/cannot move/);
  });

  it('terms hash changes when any term changes', () => {
    const base = computeEscrowTermsHash(terms);
    expect(computeEscrowTermsHash({ ...terms })).toBe(base);
    expect(computeEscrowTermsHash({ ...terms, amount: 100001n })).not.toBe(base);
    expect(computeEscrowTermsHash({ ...terms, itemDescription: 'Laptop!'})).not.toBe(base);
    expect(computeEscrowTermsHash({ ...terms, inspectionDays: 4 })).not.toBe(base);
  });
});
