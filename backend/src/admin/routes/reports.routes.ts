import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { audit } from '../audit';
import { requirePermission } from '../auth';
import { money } from '../present';

export const reportsRouter = Router();

const ZONE = 'Africa/Dar_es_Salaam';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

/** Money that enters or leaves SurePesa, versus money that only moves between accounts inside it. */
const MONEY_IN = ['DEPOSIT'];
const MONEY_OUT = ['WITHDRAWAL'];

const rangeSchema = z.object({
  from: z.string().regex(DAY, 'Use YYYY-MM-DD'),
  to: z.string().regex(DAY, 'Use YYYY-MM-DD'),
});

/** Inclusive calendar days in East Africa Time -> [start, end) instants. */
function parseRange(query: unknown) {
  const { from, to } = rangeSchema.parse(query);
  const start = new Date(`${from}T00:00:00+03:00`);
  const end = new Date(new Date(`${to}T00:00:00+03:00`).getTime() + 86_400_000);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (Number.isNaN(days) || days < 1) throw new AppError('INVALID_RANGE', 'The end date must be on or after the start date.');
  if (days > MAX_DAYS) throw new AppError('RANGE_TOO_LONG', `Reports cover at most ${MAX_DAYS} days.`);
  return { from, to, start, end, days };
}

/**
 * Money movement report (TZS): completed volume and fees by day, by type and by rail, plus
 * failure counts. "Completed" means SUCCESS or later REVERSED; reversals are listed on their own
 * line so nothing is counted twice.
 */
reportsRouter.get('/reports/movement', requirePermission('reports:view'), async (req, res) => {
  const { from, to, start, end, days } = parseRange(req.query);

  const [daily, byType, byRail] = await Promise.all([
    prisma.$queryRaw<{ day: Date; money_in: bigint; money_out: bigint; internal: bigint; fees: bigint; count: number; failed: number }[]>`
      SELECT date_trunc('day', created_at AT TIME ZONE ${ZONE}) AS day,
             COALESCE(SUM(amount) FILTER (WHERE status IN ('SUCCESS','REVERSED') AND type::text = ANY(${MONEY_IN})), 0)::bigint AS money_in,
             COALESCE(SUM(amount) FILTER (WHERE status IN ('SUCCESS','REVERSED') AND type::text = ANY(${MONEY_OUT})), 0)::bigint AS money_out,
             COALESCE(SUM(amount) FILTER (WHERE status IN ('SUCCESS','REVERSED') AND NOT (type::text = ANY(${[...MONEY_IN, ...MONEY_OUT, 'REVERSAL']}))), 0)::bigint AS internal,
             COALESCE(SUM(fee) FILTER (WHERE status IN ('SUCCESS','REVERSED')), 0)::bigint AS fees,
             count(*)::int AS count,
             (count(*) FILTER (WHERE status = 'FAILED'))::int AS failed
      FROM transactions
      WHERE created_at >= ${start} AND created_at < ${end} AND currency_code = 'TZS'
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ type: string; count: number; completed: number; failed: number; pending: number; volume: bigint; fees: bigint }[]>`
      SELECT type::text AS type,
             count(*)::int AS count,
             (count(*) FILTER (WHERE status IN ('SUCCESS','REVERSED')))::int AS completed,
             (count(*) FILTER (WHERE status IN ('FAILED','CANCELLED')))::int AS failed,
             (count(*) FILTER (WHERE status IN ('PENDING','PROCESSING')))::int AS pending,
             COALESCE(SUM(amount) FILTER (WHERE status IN ('SUCCESS','REVERSED')), 0)::bigint AS volume,
             COALESCE(SUM(fee) FILTER (WHERE status IN ('SUCCESS','REVERSED')), 0)::bigint AS fees
      FROM transactions
      WHERE created_at >= ${start} AND created_at < ${end} AND currency_code = 'TZS'
      GROUP BY 1 ORDER BY volume DESC`,
    prisma.$queryRaw<{ rail: string; type: string; count: number; completed: number; failed: number; volume: bigint }[]>`
      SELECT COALESCE(provider_name, 'UNKNOWN') AS rail, type::text AS type,
             count(*)::int AS count,
             (count(*) FILTER (WHERE status IN ('SUCCESS','REVERSED')))::int AS completed,
             (count(*) FILTER (WHERE status IN ('FAILED','CANCELLED')))::int AS failed,
             COALESCE(SUM(amount) FILTER (WHERE status IN ('SUCCESS','REVERSED')), 0)::bigint AS volume
      FROM transactions
      WHERE created_at >= ${start} AND created_at < ${end} AND currency_code = 'TZS'
        AND type::text = ANY(${[...MONEY_IN, ...MONEY_OUT]})
      GROUP BY 1, 2 ORDER BY volume DESC`,
  ]);

  const sum = (pick: (d: (typeof daily)[number]) => bigint) => daily.reduce((n, d) => n + pick(d), 0n);
  const moneyIn = sum((d) => d.money_in);
  const moneyOut = sum((d) => d.money_out);
  const count = daily.reduce((n, d) => n + d.count, 0);
  const failed = daily.reduce((n, d) => n + d.failed, 0);

  res.json({
    range: { from, to, days, timeZone: ZONE, currency: 'TZS' },
    totals: {
      moneyIn: await money(moneyIn, 'TZS'),
      moneyOut: await money(moneyOut, 'TZS'),
      netFlow: await money(moneyIn - moneyOut, 'TZS'),
      internal: await money(sum((d) => d.internal), 'TZS'),
      fees: await money(sum((d) => d.fees), 'TZS'),
      transactions: count,
      failed,
      failureRate: count ? Math.round((failed / count) * 1000) / 10 : null,
    },
    daily: await Promise.all(
      daily.map(async (d) => ({
        day: d.day,
        moneyIn: await money(d.money_in, 'TZS'),
        moneyOut: await money(d.money_out, 'TZS'),
        internal: await money(d.internal, 'TZS'),
        fees: await money(d.fees, 'TZS'),
        count: d.count,
        failed: d.failed,
      })),
    ),
    byType: await Promise.all(
      byType.map(async (t) => ({ ...t, volume: await money(t.volume, 'TZS'), fees: await money(t.fees, 'TZS') })),
    ),
    byRail: await Promise.all(byRail.map(async (r) => ({ ...r, volume: await money(r.volume, 'TZS') }))),
  });
});

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  // Quote, and neutralise spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n']/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Every TZS transaction in the range as CSV, for Finance reconciliation. Audited. */
reportsRouter.get('/reports/movement.csv', requirePermission('reports:export'), async (req, res) => {
  const { from, to, start, end } = parseRange(req.query);
  const rows = await prisma.transaction.findMany({
    where: { createdAt: { gte: start, lt: end }, currencyCode: 'TZS' },
    orderBy: { createdAt: 'asc' },
    take: 50_000,
    select: {
      reference: true, type: true, status: true, amount: true, fee: true, currencyCode: true,
      providerName: true, providerReference: true, failureCode: true, createdAt: true, completedAt: true,
    },
  });

  await audit({
    actorId: req.admin!.id,
    action: 'REPORT_EXPORTED',
    entityType: 'report',
    entityId: `movement:${from}:${to}`,
    after: { rows: rows.length },
    ipAddress: req.ip,
  });

  const header = ['reference', 'type', 'status', 'amount', 'fee', 'currency', 'rail', 'rail_reference', 'failure_code', 'created_at', 'completed_at'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.reference, r.type, r.status, await money(r.amount, 'TZS'), await money(r.fee, 'TZS'), r.currencyCode,
        r.providerName, r.providerReference, r.failureCode, r.createdAt.toISOString(), r.completedAt?.toISOString(),
      ].map(csvCell).join(','),
    );
  }
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="surepesa-movement-${from}-to-${to}.csv"`);
  res.setHeader('cache-control', 'no-store');
  res.send(lines.join('\n') + '\n');
});
