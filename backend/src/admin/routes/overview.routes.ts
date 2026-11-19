import { Router } from 'express';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { checkStorage } from '../../lib/storage';
import { reconcileLedger } from '../../services/ledger.service';
import { requirePermission } from '../auth';
import { money, presentTransaction, transactionListInclude } from '../present';

export const overviewRouter = Router();

const OPEN_CASE = ['OPEN', 'IN_PROGRESS', 'ESCALATED'] as const;

/** System Controller dashboard: KPIs, 14-day activity, queues needing attention. */
overviewRouter.get('/overview', requirePermission('overview:view'), async (_req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const stuckBefore = new Date(Date.now() - 15 * 60_000);

  const [
    usersTotal, usersActive, usersSuspended, businesses, pendingKyc, openCases, pendingApprovals,
    todayByStatus, stuckProcessing, recentFailed, daily, volume30d,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where: { status: 'SUSPENDED' } }),
    prisma.business.count(),
    prisma.kycSubmission.count({ where: { status: 'PENDING' } }),
    prisma.supportCase.count({ where: { status: { in: [...OPEN_CASE] } } }),
    prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
    prisma.transaction.groupBy({
      by: ['status'],
      where: { createdAt: { gte: startOfDay }, type: { not: 'REVERSAL' } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.transaction.count({ where: { status: 'PROCESSING', createdAt: { lt: stuckBefore } } }),
    prisma.transaction.findMany({ relationLoadStrategy: 'join',
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: transactionListInclude,
    }),
    prisma.$queryRaw<{ day: Date; count: number; failed: number; volume: bigint }[]>`
      SELECT date_trunc('day', created_at AT TIME ZONE 'Africa/Dar_es_Salaam') AS day,
             count(*)::int AS count,
             (count(*) FILTER (WHERE status = 'FAILED'))::int AS failed,
             COALESCE(SUM(amount) FILTER (WHERE status IN ('SUCCESS', 'REVERSED')), 0)::bigint AS volume
      FROM transactions
      WHERE created_at >= now() - interval '14 days' AND type <> 'REVERSAL' AND currency_code = 'TZS'
      GROUP BY 1 ORDER BY 1`,
    prisma.transaction.aggregate({
      where: { status: 'SUCCESS', currencyCode: 'TZS', type: { not: 'REVERSAL' }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const today = Object.fromEntries(todayByStatus.map((g) => [g.status, g._count._all]));
  const todayCount = todayByStatus.reduce((n, g) => n + g._count._all, 0);
  const todayVolume = todayByStatus.find((g) => g.status === 'SUCCESS')?._sum.amount ?? 0n;
  const settled = (today.SUCCESS ?? 0) + (today.FAILED ?? 0);

  res.json({
    customers: { total: usersTotal, active: usersActive, suspended: usersSuspended, businesses },
    today: {
      transactions: todayCount,
      successful: today.SUCCESS ?? 0,
      failed: today.FAILED ?? 0,
      processing: today.PROCESSING ?? 0,
      volume: await money(todayVolume, 'TZS'),
      successRate: settled ? Math.round(((today.SUCCESS ?? 0) / settled) * 1000) / 10 : null,
    },
    last30Days: { transactions: volume30d._count._all, volume: await money(volume30d._sum.amount ?? 0n, 'TZS') },
    queues: { pendingKyc, openCases, pendingApprovals, stuckProcessing },
    daily: await Promise.all(
      daily.map(async (d) => ({ day: d.day, count: d.count, failed: d.failed, volume: await money(d.volume, 'TZS') })),
    ),
    recentFailed: await Promise.all(recentFailed.map(presentTransaction)),
  });
});

/** Health of every dependency plus ledger reconciliation (SOP §7, §18.1). */
overviewRouter.get('/system', requirePermission('system:view'), async (_req, res) => {
  const timed = async (fn: () => Promise<unknown>) => {
    const started = Date.now();
    try {
      const ok = (await fn()) !== false;
      return { status: ok ? 'ok' : 'down', latencyMs: Date.now() - started };
    } catch {
      return { status: 'down', latencyMs: Date.now() - started };
    }
  };

  const [database, auth, storage] = await Promise.all([
    timed(() => prisma.$queryRaw`SELECT 1`),
    timed(async () => (await fetch(env.NEON_AUTH_JWKS_URL, { signal: AbortSignal.timeout(10_000) })).ok),
    timed(checkStorage),
  ]);
  const report = await reconcileLedger(prisma);
  const [ledgerEntries, wallets, stuck] = await Promise.all([
    prisma.ledgerEntry.count(),
    prisma.wallet.count(),
    prisma.transaction.findMany({ relationLoadStrategy: 'join',
      where: { status: 'PROCESSING', createdAt: { lt: new Date(Date.now() - 15 * 60_000) } },
      take: 20,
      orderBy: { createdAt: 'asc' },
      include: transactionListInclude,
    }),
  ]);

  res.json({
    services: { database, auth, storage, paymentRails: { status: 'simulated', latencyMs: 0 } },
    reconciliation: {
      ok: report.ok,
      checkedAt: new Date(),
      ledgerEntries,
      wallets,
      walletMismatches: report.walletMismatches.length,
      currencyImbalances: report.currencyImbalances.length,
      unbalancedTransactions: report.unbalancedTransactions.length,
    },
    stuckTransactions: await Promise.all(stuck.map(presentTransaction)),
  });
});
