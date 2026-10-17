import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { displayMoney, maskPhone, presentReceipt, receiptInclude, registeredName } from '../services/receipt.service';
import { getOrCreateBusinessWallet } from '../services/wallet.service';

/**
 * Merchant portal: /v1/merchant
 *
 * Everything the merchant dashboard shows comes from one call, so the page renders in a
 * single round trip (each round trip to Neon is slow from East Africa).
 */
export const merchantRouter = Router();
merchantRouter.use(requireAuth);

const CURRENCY = 'TZS';
const DAY_MS = 86_400_000;
const SUCCEEDED = ['SUCCESS', 'REVERSED'] as const; // a reversed payment did succeed first

merchantRouter.get('/overview', async (req, res) => {
  const { businessId } = z.object({ businessId: z.string().uuid().optional() }).parse(req.query);
  res.json(await merchantOverview(req.user!.id, businessId));
});

/** The merchant dashboard in one object. */
export async function merchantOverview(userId: string, businessId?: string) {

  const [owner, businesses] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true, paymentMethods: { where: { status: { not: 'DISABLED' } }, select: { id: true } } },
    }),
    prisma.business.findMany({ where: { ownerId: userId }, orderBy: { createdAt: 'asc' } }),
  ]);
  if (!businesses.length) throw new AppError('NO_BUSINESS', 'You have no business on SurePesa yet', 404);
  const business = businessId ? businesses.find((b) => b.id === businessId) : businesses[0];
  if (!business) throw new AppError('BUSINESS_NOT_FOUND', 'Business not found', 404);

  const wallet = await getOrCreateBusinessWallet(prisma, business.id, CURRENCY);
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY_MS);
  const since60 = new Date(now - 60 * DAY_MS);
  const payments = { destinationWalletId: wallet.id, type: 'MERCHANT_PAYMENT' as const };

  const [last30, prev30, failed30, customers, daily, recent, openRequests] = await Promise.all([
    prisma.transaction.aggregate({ where: { ...payments, status: { in: [...SUCCEEDED] }, createdAt: { gte: since30 } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.transaction.aggregate({ where: { ...payments, status: { in: [...SUCCEEDED] }, createdAt: { gte: since60, lt: since30 } }, _sum: { amount: true } }),
    prisma.transaction.count({ where: { ...payments, status: 'FAILED', createdAt: { gte: since30 } } }),
    prisma.transaction.groupBy({ by: ['sourceWalletId'], where: { ...payments, status: { in: [...SUCCEEDED] } } }),
    prisma.$queryRaw<{ day: string; volume: bigint; count: number }[]>`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Africa/Dar_es_Salaam'), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(amount), 0)::bigint AS volume, count(*)::int AS count
      FROM transactions
      WHERE destination_wallet_id = ${wallet.id}::uuid AND type = 'MERCHANT_PAYMENT'
        AND status IN ('SUCCESS', 'REVERSED') AND created_at >= now() - interval '14 days'
      GROUP BY 1 ORDER BY 1`,
    prisma.transaction.findMany({
      relationLoadStrategy: 'join',
      where: { ...payments },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: receiptInclude,
    }),
    prisma.qrCode.count({ where: { businessId: business.id, type: 'DYNAMIC', usedAt: null, isActive: true, expiresAt: { gt: new Date() } } }),
  ]);

  // Onboarding: what still stands between this merchant and taking payments and payouts.
  const detailsMissing = [
    !business.category && 'category',
    !business.region && 'region',
    !business.phoneNumber && 'phone number',
    !business.registrationNo && !business.tin && 'BRELA number or TIN',
  ].filter(Boolean) as string[];
  const everPaid = customers.length > 0;
  const steps = [
    {
      key: 'details',
      label: 'Business details',
      done: detailsMissing.length === 0,
      detail: detailsMissing.length ? `Add ${detailsMissing.join(', ')}` : 'Complete',
    },
    {
      key: 'verification',
      label: 'Business verification',
      done: business.kycStatus === 'APPROVED',
      detail: {
        NOT_STARTED: 'Upload your registration documents',
        PENDING: 'In review, usually within one working day',
        APPROVED: 'Verified',
        REJECTED: 'Needs changes: see the reviewer note',
      }[business.kycStatus],
      state: business.kycStatus,
    },
    {
      key: 'payout',
      label: 'Payout account',
      done: owner.paymentMethods.length > 0,
      detail: owner.paymentMethods.length ? 'Linked' : 'Link the mobile money account you withdraw to',
    },
    {
      key: 'first_payment',
      label: 'First payment',
      done: everPaid,
      detail: everPaid ? 'Received' : 'Share your till number or a payment request',
    },
  ];

  // 14 days, oldest first, with empty days filled in so the chart has no gaps.
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const days = await Promise.all(
    Array.from({ length: 14 }, async (_, i) => {
      const date = new Date(now - (13 - i) * DAY_MS).toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
      const d = byDay.get(date);
      return { day: date, count: d?.count ?? 0, volume: await displayMoney(d?.volume ?? 0n, CURRENCY) };
    }),
  );

  const succeeded = last30._count._all;
  return {
    owner: { name: registeredName(owner.profile), phone: maskPhone(owner.phoneNumber) },
    businesses: businesses.map((b) => ({ id: b.id, tradingName: b.tradingName, merchantCode: b.merchantCode })),
    business: {
      id: business.id,
      tradingName: business.tradingName,
      legalName: business.legalName,
      merchantCode: business.merchantCode,
      kycStatus: business.kycStatus,
      balance: await displayMoney(wallet.balance, CURRENCY),
    },
    onboarding: { steps, done: steps.filter((s) => s.done).length, total: steps.length },
    stats: {
      volume30d: await displayMoney(last30._sum.amount ?? 0n, CURRENCY),
      volumePrev30d: await displayMoney(prev30._sum.amount ?? 0n, CURRENCY),
      payments30d: succeeded,
      customers: customers.length,
      successRate30d: succeeded + failed30 > 0 ? succeeded / (succeeded + failed30) : null,
    },
    daily: days,
    recent: await Promise.all(recent.map((t) => presentReceipt(t, userId))),
    openPaymentRequests: openRequests,
  };
}
