import { createHash } from 'node:crypto';
import { EscrowStatus } from '@prisma/client';
import { AppError } from '../../lib/errors';

/**
 * Escrow deal state machine (blueprint §10). No automatic release: the inspection
 * window is part of the accepted terms and only an explicit buyer acceptance or an
 * authorised dispute resolution can release funds. Disputes freeze all payouts.
 */
export type EscrowActor = 'BUYER' | 'SELLER' | 'ADMIN' | 'SYSTEM';

const TRANSITIONS: Record<EscrowActor, Partial<Record<EscrowStatus, EscrowStatus[]>>> = {
  BUYER: {
    DRAFT: ['AWAITING_COUNTERPARTY', 'CANCELLED'],
    AWAITING_COUNTERPARTY: ['CANCELLED'],
    TERMS_ACCEPTED: ['CANCELLED'],
    AWAITING_FUNDING: ['FUNDING_PROCESSING', 'CANCELLED'],
    AWAITING_BUYER_CONFIRMATION: ['RELEASE_PENDING', 'DISPUTED'],
    FUNDED: ['DISPUTED'],
    FULFILMENT_IN_PROGRESS: ['DISPUTED'],
  },
  SELLER: {
    AWAITING_COUNTERPARTY: ['TERMS_ACCEPTED', 'DECLINED'],
    FUNDED: ['FULFILMENT_IN_PROGRESS', 'DISPUTED', 'REFUND_PENDING'],
    FULFILMENT_IN_PROGRESS: ['AWAITING_BUYER_CONFIRMATION', 'DISPUTED', 'REFUND_PENDING'],
    AWAITING_BUYER_CONFIRMATION: ['DISPUTED', 'REFUND_PENDING'],
  },
  ADMIN: {
    DISPUTED: ['RELEASE_PENDING', 'REFUND_PENDING', 'REVIEW_REQUIRED'],
    REVIEW_REQUIRED: ['RELEASE_PENDING', 'REFUND_PENDING'],
  },
  SYSTEM: {
    TERMS_ACCEPTED: ['AWAITING_FUNDING', 'EXPIRED'],
    FUNDING_PROCESSING: ['FUNDED', 'FUNDING_FAILED'],
    RELEASE_PENDING: ['RELEASED', 'REVIEW_REQUIRED'],
    REFUND_PENDING: ['REFUNDED', 'REVIEW_REQUIRED'],
    AWAITING_FUNDING: ['EXPIRED'],
    DRAFT: ['EXPIRED'],
    AWAITING_COUNTERPARTY: ['EXPIRED'],
  },
};

export const ESCROW_EXPIRABLE_STATES: ReadonlySet<EscrowStatus> = new Set([
  'DRAFT',
  'AWAITING_COUNTERPARTY',
  'TERMS_ACCEPTED',
  'AWAITING_FUNDING',
]);

export function assertEscrowTransition(from: EscrowStatus, to: EscrowStatus, actor: EscrowActor): void {
  const allowed = TRANSITIONS[actor]?.[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(
      'ESCROW_ILLEGAL_TRANSITION',
      `An escrow case cannot move from ${from} to ${to} by ${actor.toLowerCase()}`,
      409,
      { from, to, actor },
    );
  }
}

export interface EscrowTerms {
  buyerId: string;
  sellerId: string;
  itemDescription: string;
  amount: bigint;
  currencyCode: string;
  feeAmount: bigint;
  fundingDeadline: string; // ISO
  deliveryDeadline: string | null;
  inspectionDays: number;
}

/** sha256 over the canonical terms; both parties must accept exactly these terms. */
export function computeEscrowTermsHash(terms: EscrowTerms): string {
  const canonical = [
    terms.buyerId,
    terms.sellerId,
    terms.itemDescription,
    terms.amount.toString(),
    terms.currencyCode,
    terms.feeAmount.toString(),
    terms.fundingDeadline,
    terms.deliveryDeadline ?? '',
    String(terms.inspectionDays),
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}
