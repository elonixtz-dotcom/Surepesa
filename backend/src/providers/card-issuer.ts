/**
 * Boundary between SurePesa and a virtual-card issuer (e.g. Selcom VCN, a bank's BIN sponsor).
 *
 * PCI: SurePesa never stores a full card number (PAN) or CVV. `revealCard` either returns them
 * for one-time display (never persisted, never logged) or asks the issuer to deliver them to the
 * customer directly, as Selcom's "Show Card" does with a secure SMS link.
 */

export type CardBrand = 'VISA' | 'MASTERCARD';

export interface IssueCardRequest {
  /** Our card id; the issuer echoes it for correlation and idempotency. */
  reference: string;
  holderName: string;
  phoneNumber: string;
  email?: string | null;
  currency: string;
  validityMonths: 6 | 12 | 24;
}

export interface IssuedCard {
  status: 'ACTIVE' | 'PENDING' | 'FAILED';
  issuerCardId?: string;
  brand?: CardBrand;
  last4?: string;
  expiryMonth?: number;
  expiryYear?: number;
  failureReason?: string;
}

export type RevealedCard =
  | { kind: 'DETAILS'; pan: string; cvv: string; expiryMonth: number; expiryYear: number; holderName: string }
  | { kind: 'DELIVERED'; channel: 'SMS' | 'EMAIL'; message: string };

export type CardEventKind = 'AUTHORIZATION' | 'REVERSAL' | 'REFUND';

/** A verified issuer event. Authorisations need an approve/decline answer in the response. */
export interface CardEvent {
  eventId: string;
  kind: CardEventKind;
  issuerCardId: string;
  /** The issuer's authorisation id; reversals and refunds point at the original. */
  authId: string;
  amount: bigint;
  currency: string;
  merchantName?: string;
  merchantCountry?: string;
}

export class InvalidCardEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCardEventError';
  }
}

export interface CardIssuer {
  readonly name: string;
  issueCard(req: IssueCardRequest): Promise<IssuedCard>;
  /** For cards that came back PENDING. */
  cardStatus(issuerCardId: string): Promise<IssuedCard>;
  setStatus(issuerCardId: string, status: 'ACTIVE' | 'BLOCKED' | 'TERMINATED'): Promise<void>;
  /** Online (e-commerce) limit per transaction, minor units; null removes it. */
  setLimit(issuerCardId: string, perTransaction: bigint | null): Promise<void>;
  revealCard(issuerCardId: string): Promise<RevealedCard>;
  /** Verify a raw event body (signature over the exact bytes, replay window) and parse it. */
  parseEvent(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): CardEvent;
}
