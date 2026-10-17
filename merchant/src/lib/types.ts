/** Shapes returned by the SurePesa API (see backend/src/routes/merchant.routes.ts, receipt.service.ts). */

export interface Money {
  value: string;
  formatted: string;
}

export interface OnboardingStep {
  key: 'details' | 'verification' | 'payout' | 'first_payment';
  label: string;
  done: boolean;
  detail: string;
  state?: 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface Receipt {
  reference: string;
  type: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REVERSED' | 'CANCELLED';
  statusText: string;
  final: boolean;
  direction: 'IN' | 'OUT';
  amount: Money;
  fee: Money;
  total: Money;
  currency: string;
  counterparty: { name: string | null; account: string | null } | null;
  description: string | null;
  refunded: Money | null;
  createdAt: string;
  completedAt: string | null;
}

export interface MerchantOverview {
  owner: { name: string | null; phone: string | null };
  businesses: { id: string; tradingName: string; merchantCode: string }[];
  business: {
    id: string;
    tradingName: string;
    legalName: string;
    merchantCode: string;
    kycStatus: string;
    balance: Money;
  };
  onboarding: { steps: OnboardingStep[]; done: number; total: number };
  stats: {
    volume30d: Money;
    volumePrev30d: Money;
    payments30d: number;
    customers: number;
    successRate30d: number | null;
  };
  daily: { day: string; count: number; volume: Money }[];
  recent: Receipt[];
  openPaymentRequests: number;
}

export interface PaymentRequest {
  type: 'DYNAMIC';
  merchantCode: string;
  qrCodeId: string;
  amount: string;
  currency: string;
  expiresAt: string;
  payload: string;
}
