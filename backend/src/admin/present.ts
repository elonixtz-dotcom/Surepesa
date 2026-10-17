import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { fromMinorUnits } from '../lib/money';

/** Presentation helpers shared by the back-office routes. */

let minorUnitsCache: Map<string, number> | undefined;

export async function money(minor: bigint, currency: string): Promise<string> {
  if (!minorUnitsCache) {
    const currencies = await prisma.currency.findMany();
    minorUnitsCache = new Map(currencies.map((c) => [c.code, c.minorUnits]));
  }
  return fromMinorUnits(minor, minorUnitsCache.get(currency) ?? 2);
}

/** Wallet with enough owner data to label it ("Halca Alane · +255712…", "Kijiji Market", "System float"). */
export const walletOwnerInclude = {
  user: { select: { id: true, phoneNumber: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
  business: { select: { id: true, tradingName: true, merchantCode: true } },
} satisfies Prisma.WalletInclude;

type WalletWithOwner = Prisma.WalletGetPayload<{ include: typeof walletOwnerInclude }>;

export function walletLabel(w: WalletWithOwner | null | undefined) {
  if (!w) return null;
  if (w.user) {
    const name = [w.user.profile?.firstName, w.user.profile?.lastName].filter(Boolean).join(' ');
    return { kind: 'USER', id: w.user.id, name: name || w.user.email || 'Customer', detail: w.user.phoneNumber };
  }
  if (w.business) return { kind: 'BUSINESS', id: w.business.id, name: w.business.tradingName, detail: w.business.merchantCode };
  const systemNames: Record<string, string> = {
    SYSTEM_FLOAT: 'External rail (float)',
    SYSTEM_FEES: 'SurePesa fees',
    SYSTEM_FX: 'FX position',
  };
  return { kind: 'SYSTEM', id: null, name: systemNames[w.kind] ?? 'System', detail: w.systemCode };
}

export const transactionListInclude = {
  sourceWallet: { include: walletOwnerInclude },
  destinationWallet: { include: walletOwnerInclude },
} satisfies Prisma.TransactionInclude;

type TransactionForList = Prisma.TransactionGetPayload<{ include: typeof transactionListInclude }>;

export async function presentTransaction(t: TransactionForList) {
  return {
    id: t.id,
    reference: t.reference,
    type: t.type,
    status: t.status,
    amount: await money(t.amount, t.currencyCode),
    fee: await money(t.fee, t.currencyCode),
    currency: t.currencyCode,
    from: walletLabel(t.sourceWallet),
    to: walletLabel(t.destinationWallet),
    description: t.description,
    failureCode: t.failureCode,
    failureReason: t.failureReason,
    providerName: t.providerName,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
  };
}

export function displayName(u: { email?: string | null; profile?: { firstName: string; lastName: string } | null }) {
  return u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : (u.email ?? 'Customer');
}

/** Shows only the last 4 characters of an identifier (ID numbers for non-compliance staff). */
export const mask = (value: string) => (value.length <= 4 ? '••••' : `${'•'.repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`);

export function pageParams(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(query.pageSize) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
