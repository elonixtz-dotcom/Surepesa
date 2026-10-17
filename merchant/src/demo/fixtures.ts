import type { MerchantOverview, Money, PaymentRequest, Receipt } from '../lib/types';
import real from './overview.json';

/**
 * Demo data for `npm run demo` (no sign-in, no API). `overview.json` is the real API payload
 * for the demo merchant (backend: `npx tsx scripts/merchant-overview.ts SPM100001 <file>`);
 * the variants below are synthetic and exist only to show every state of the dashboard.
 *
 *   ?demo=busy   a few weeks of trading
 *   ?demo=new    a merchant who has just signed up (empty states, onboarding first)
 *   (default)    the real seeded demo merchant
 */
const tzs = (major: number): Money => ({
  value: major.toFixed(2),
  formatted: `TZS ${major.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
});

const daysBack = (n: number) => new Date(Date.now() - n * 86_400_000);

function variant(): string | null {
  return new URLSearchParams(window.location.search).get('demo');
}

function busy(base: MerchantOverview): MerchantOverview {
  const pattern = [3, 5, 4, 7, 6, 9, 2, 4, 8, 6, 10, 7, 11, 9];
  const daily = pattern.map((count, i) => ({
    day: daysBack(13 - i).toISOString().slice(0, 10),
    count,
    volume: tzs(count * 14_250 + (i % 3) * 4_000),
  }));
  const names: [string, string, number, Receipt['status']][] = [
    ['NEEMA SHIRIMA', '+255 69* *** 007', 24_000, 'SUCCESS'],
    ['BARAKA NDEGE', '+255 69* *** 006', 8_500, 'SUCCESS'],
    ['LUNA MASSAWE', '+255 69* *** 005', 15_000, 'FAILED'],
    ['JOHN MUSHI', '+255 69* *** 002', 42_000, 'SUCCESS'],
    ['HALCA ALANE', '+255 69* *** 001', 18_000, 'SUCCESS'],
  ];
  const recent: Receipt[] = names.map(([name, account, amount, status], i) => ({
    ...base.recent[0]!,
    reference: `SPX-DEMO${String(i).padStart(6, '0')}`,
    status,
    statusText: status === 'FAILED' ? 'Failed: Insufficient funds' : 'Completed',
    amount: tzs(amount),
    total: tzs(amount),
    counterparty: { name, account },
    refunded: i === 3 ? tzs(7_000) : null,
    createdAt: new Date(Date.now() - (i * 47 + 6) * 60_000).toISOString(),
  }));
  return {
    ...base,
    business: { ...base.business, kycStatus: 'APPROVED', balance: tzs(1_284_350) },
    onboarding: { steps: base.onboarding.steps.map((s) => ({ ...s, done: true, detail: 'Complete' })), done: 4, total: 4 },
    stats: { volume30d: tzs(2_118_400), volumePrev30d: tzs(1_742_900), payments30d: 186, customers: 94, successRate30d: 0.968 },
    daily,
    recent,
    openPaymentRequests: 2,
  };
}

function fresh(base: MerchantOverview): MerchantOverview {
  return {
    ...base,
    business: { ...base.business, kycStatus: 'NOT_STARTED', balance: tzs(0) },
    onboarding: {
      steps: base.onboarding.steps.map((s) =>
        s.key === 'payout' || s.key === 'first_payment'
          ? { ...s, done: false, detail: s.key === 'payout' ? 'Link the mobile money account you withdraw to' : 'Share your till number or a payment request' }
          : s,
      ),
      done: 0,
      total: 4,
    },
    stats: { volume30d: tzs(0), volumePrev30d: tzs(0), payments30d: 0, customers: 0, successRate30d: null },
    daily: base.daily.map((d) => ({ ...d, count: 0, volume: tzs(0) })),
    recent: [],
    openPaymentRequests: 0,
  };
}

export async function demoOverview(_businessId?: string): Promise<MerchantOverview> {
  await new Promise((r) => setTimeout(r, 350)); // feel a real round trip
  const base = real as MerchantOverview;
  const v = variant();
  return v === 'busy' ? busy(base) : v === 'new' ? fresh(base) : base;
}

export async function demoPaymentRequest(merchantCode: string, amount: string): Promise<PaymentRequest> {
  await new Promise((r) => setTimeout(r, 500));
  return {
    type: 'DYNAMIC',
    merchantCode,
    qrCodeId: '00000000-0000-4000-8000-000000000000',
    amount,
    currency: 'TZS',
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    payload: `00020101021226330014TZ.CO.SUREPESA0109${merchantCode}5204599953038345405${amount}5802TZ5922Mama Ntilie Restaurant6013Dar es Salaam62240520DEMO0000000000000000063041A2B`,
  };
}
