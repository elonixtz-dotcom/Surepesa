/**
 * Boundary between SurePesa and external money rails (mobile money, banks, international).
 *
 * Payment services call these methods; they never call a provider's API directly.
 * Adding M-Pesa, Airtel Money, a bank, or a cross-border rail means adding one adapter
 * that implements this interface — not changing the payment engine.
 */

export type ProviderStatus = 'SUCCESS' | 'PENDING' | 'FAILED';

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
  /** The provider's own id for this operation. */
  providerReference: string;
  failureCode?: string;
  failureReason?: string;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  /** Pull money from the customer's external account into SurePesa (deposit / "Add money"). */
  collect(req: CollectionRequest): Promise<ProviderResult>;
  /** Push money from SurePesa to the customer's external account (withdrawal). */
  payout(req: PayoutRequest): Promise<ProviderResult>;
}
