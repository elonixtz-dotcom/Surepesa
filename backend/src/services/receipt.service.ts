import { Prisma, Transaction } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { formatMoney, fromMinorUnits } from '../lib/money';

/**
 * Customer-facing view of a transaction: the in-app receipt. Carries both our reference and
 * the rail's (what the customer quotes to M-Pesa/Airtel support), and a status in plain words
 * instead of an internal code.
 */

const minorUnitsCache = new Map<string, number>();

export async function minorUnitsOf(currency: string): Promise<number> {
  const cached = minorUnitsCache.get(currency);
  if (cached !== undefined) return cached;
  const c = await prisma.currency.findUnique({ where: { code: currency } });
  const units = c?.minorUnits ?? 2;
  minorUnitsCache.set(currency, units);
  return units;
}

export async function displayMoney(minor: bigint, currency: string) {
  const units = await minorUnitsOf(currency);
  return { value: fromMinorUnits(minor, units), formatted: formatMoney(minor, currency, units) };
}

/** +255712345678 -> +255 71* *** 678 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const m = /^\+255(\d{2})\d{4}(\d{3})$/.exec(phone);
  return m ? `+255 ${m[1]}* *** ${m[2]}` : `${phone.slice(0, 4)}•••${phone.slice(-3)}`;
}

/** Registered name as mobile-money apps show it before you confirm: "JUMA MOSHI". */
export function registeredName(profile: { firstName: string; lastName: string } | null | undefined): string | null {
  return profile ? `${profile.firstName} ${profile.lastName}`.toUpperCase() : null;
}

const RAIL_NAMES: Record<string, string> = {
  MPESA_TZ: 'M-Pesa',
  AIRTEL_TZ: 'Airtel Money',
  YAS_TZ: 'Mixx by Yas',
  HALOPESA: 'HaloPesa',
  SELCOM: 'Selcom',
  SIMULATED: 'the payment network',
};
export const railName = (provider: string | null | undefined) => (provider ? (RAIL_NAMES[provider] ?? provider) : 'the payment network');

export const receiptInclude = {
  sourceWallet: { include: { user: { include: { profile: true } }, business: true } },
  destinationWallet: { include: { user: { include: { profile: true } }, business: true } },
  paymentMethod: true,
  reverses: { select: { reference: true } },
  refunds: { select: { reference: true } },
  refundedBy: { where: { status: 'SUCCESS' }, select: { amount: true, reference: true } },
} satisfies Prisma.TransactionInclude;

export type ReceiptTransaction = Prisma.TransactionGetPayload<{ include: typeof receiptInclude }>;

function statusText(t: Transaction, direction: 'IN' | 'OUT', rail: string): string {
  switch (t.status) {
    case 'SUCCESS':
      return 'Completed';
    case 'FAILED':
      return t.failureReason ? `Failed: ${t.failureReason}` : 'Failed. No money was taken.';
    case 'REVERSED':
      return 'Reversed. The money was returned.';
    case 'CANCELLED':
      return 'Cancelled';
    case 'PENDING':
      return 'Starting';
    case 'PROCESSING':
      if (t.escalatedAt) return `Taking longer than usual. We are checking with ${rail}; your money is safe.`;
      if (t.type === 'DEPOSIT' && t.railStatus === 'PENDING') return 'Approve the request on your phone to finish';
      if (t.type === 'WITHDRAWAL' && t.railStatus === 'PENDING') return `Sending to your ${rail} account`;
      if (t.railStatus === 'AMBIGUOUS') return `Confirming with ${rail}. This can take a few minutes.`;
      return direction === 'OUT' ? 'Sending' : 'Receiving';
  }
}

function walletParty(w: ReceiptTransaction['sourceWallet']) {
  if (!w) return null;
  if (w.business) return { name: w.business.tradingName, account: w.business.merchantCode };
  if (w.user) return { name: registeredName(w.user.profile), account: maskPhone(w.user.phoneNumber) };
  return null;
}

/** `viewerUserId` decides direction (money in or out) and which side is the counterparty. */
export async function presentReceipt(t: ReceiptTransaction, viewerUserId: string) {
  const isMine = (w: ReceiptTransaction['sourceWallet']) => !!w && (w.userId === viewerUserId || w.business?.ownerId === viewerUserId);
  const direction: 'IN' | 'OUT' = isMine(t.destinationWallet) && !isMine(t.sourceWallet) ? 'IN' : 'OUT';
  const rail = railName(t.paymentMethod?.provider ?? t.providerName);

  let counterparty: { name: string | null; account: string | null } | null;
  if (t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL') {
    counterparty = t.paymentMethod
      ? { name: t.paymentMethod.accountName ?? t.paymentMethod.label ?? rail, account: t.paymentMethod.maskedNumber }
      : { name: rail, account: null };
  } else {
    counterparty = walletParty(direction === 'OUT' ? t.destinationWallet : t.sourceWallet);
  }

  // Fees are paid by the sender; the receiver sees only the amount.
  const fee = direction === 'OUT' ? t.fee : 0n;
  const refunded = t.refundedBy.reduce((sum, r) => sum + r.amount, 0n);
  return {
    reference: t.reference,
    type: t.type,
    status: t.status,
    statusText: statusText(t, direction, rail),
    final: !['PENDING', 'PROCESSING'].includes(t.status),
    direction,
    amount: await displayMoney(t.amount, t.currencyCode),
    fee: await displayMoney(fee, t.currencyCode),
    total: await displayMoney(t.amount + fee, t.currencyCode),
    currency: t.currencyCode,
    counterparty,
    description: t.description,
    rail: t.providerName ? { name: rail, reference: t.providerReference } : null,
    relatedTo: t.reverses?.reference ?? t.refunds?.reference ?? null,
    refunded: refunded > 0n ? await displayMoney(refunded, t.currencyCode) : null,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
  };
}

export async function loadReceipt(transactionId: string, viewerUserId: string) {
  const t = await prisma.transaction.findUniqueOrThrow({ relationLoadStrategy: 'join', where: { id: transactionId }, include: receiptInclude });
  return presentReceipt(t, viewerUserId);
}
