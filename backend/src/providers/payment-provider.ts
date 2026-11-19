/**
 * Boundary between SurePesa and external money rails (mobile money, banks, international).
 *
 * Payment services call these methods; they never call a provider's API directly.
 * Adding M-Pesa, Airtel Money, Selcom, a bank, or a cross-border rail means adding one
 * adapter that implements this interface — not changing the payment engine.
 *
 * Real rails are asynchronous. A request usually returns PENDING and the final outcome
 * arrives later, by callback (webhook) or by asking the rail with `queryStatus`.
 */

/**
 * - SUCCESS / FAILED: final.
 * - PENDING: accepted, outcome will follow (e.g. the customer still has to approve a
 *   push-USSD prompt with their PIN).
 * - AMBIGUOUS: the rail could not say whether money moved (timeout, INPROGRESS, unknown
 *   status). Never treat this as FAILED — money may already have moved. Resolve it by
 *   querying the rail later.
 */
export type ProviderStatus = 'SUCCESS' | 'PENDING' | 'FAILED' | 'AMBIGUOUS';

export const FINAL_PROVIDER_STATUSES: readonly ProviderStatus[] = ['SUCCESS', 'FAILED'];

export interface CollectionRequest {
  /** Our transaction reference, sent to the provider for correlation and idempotency. */
  reference: string;
  amount: bigint;
  currency: string;
  /** The customer's account at the provider (phone number, bank account ...). */
  accountNumber: string;
  description?: string;
}

export type PayoutRequest = CollectionRequest;

export interface ProviderResult {
  status: ProviderStatus;
  /** The provider's own id for this operation. May be absent when the outcome is AMBIGUOUS. */
  providerReference?: string;
  failureCode?: string;
  failureReason?: string;
  raw?: unknown;
}

export interface StatusQuery {
  kind: 'COLLECTION' | 'PAYOUT';
  reference: string;
  providerReference?: string | null;
  accountNumber: string;
}

export interface AccountLookup {
  /** Name registered with the provider, as the provider returns it (often upper case). */
  accountName: string | null;
  valid: boolean;
}

/** An inbound callback, after its signature has been verified. */
export interface ProviderCallback {
  /** Unique id of this delivery's event at the provider; used to drop duplicates. */
  eventId: string;
  /** Our transaction reference, when the provider echoes it. */
  reference?: string;
  providerReference?: string;
  status: ProviderStatus;
  failureCode?: string;
  failureReason?: string;
}

export class InvalidCallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCallbackError';
  }
}

export interface PaymentProvider {
  readonly name: string;
  /** Pull money from the customer's external account into SurePesa (deposit / "Add money"). */
  collect(req: CollectionRequest): Promise<ProviderResult>;
  /** Push money from SurePesa to the customer's external account (withdrawal). */
  payout(req: PayoutRequest): Promise<ProviderResult>;
  /** Ask the rail for the current outcome of an earlier collect/payout. */
  queryStatus(query: StatusQuery): Promise<ProviderResult>;
  /** Resolve the registered name behind an account, shown to the user before they confirm. */
  lookupAccount(accountNumber: string): Promise<AccountLookup>;
  /**
   * Verify and parse a raw callback body. Must check the signature against the raw bytes
   * (never a re-serialised JSON object) and reject stale timestamps.
   * Throws InvalidCallbackError when the callback cannot be trusted.
   */
  parseCallback(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderCallback;
}
