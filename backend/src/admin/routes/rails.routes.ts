import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { checkRailNow } from '../../services/rail-sync.service';
import { audit } from '../audit';
import { requirePermission } from '../auth';
import { pageParams, presentTransaction, transactionListInclude } from '../present';

/**
 * Finance view of deposits and withdrawals the rails have not settled.
 * Funds stay held while a transaction is here; nothing is guessed. Escalated ones need a
 * person: check the rail's portal or statement, then re-check here or raise a reversal.
 */
export const railsRouter = Router();

railsRouter.get('/rails/open', requirePermission('rails:manage'), async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const escalatedOnly = req.query.escalated === 'true';
  const where = {
    status: 'PROCESSING' as const,
    type: { in: ['DEPOSIT' as const, 'WITHDRAWAL' as const] },
    ...(escalatedOnly ? { escalatedAt: { not: null } } : {}),
  };
  const [total, escalated, items] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.count({ where: { ...where, escalatedAt: { not: null } } }),
    prisma.transaction.findMany({
      relationLoadStrategy: 'join',
      where,
      skip,
      take,
      orderBy: [{ escalatedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      include: transactionListInclude,
    }),
  ]);
  res.json({
    page,
    pageSize,
    total,
    escalated,
    items: await Promise.all(
      items.map(async (t) => ({
        ...(await presentTransaction(t)),
        rail: {
          provider: t.providerName,
          providerReference: t.providerReference,
          lastStatus: t.railStatus,
          checks: t.railCheckCount,
          nextCheckAt: t.nextRailCheckAt,
          escalatedAt: t.escalatedAt,
          escalationReason: t.escalationReason,
        },
      })),
    ),
  });
});

/** Ask the rail right now, e.g. after Finance confirmed the outcome on the provider's portal. */
railsRouter.post('/rails/:id/check', requirePermission('rails:manage'), async (req, res) => {
  const txn = await prisma.transaction.findUnique({ where: { id: String(req.params.id) }, include: { paymentMethod: true } });
  if (!txn) throw new AppError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404);
  if (txn.status !== 'PROCESSING' || !['DEPOSIT', 'WITHDRAWAL'].includes(txn.type)) {
    throw new AppError('NOT_OPEN', 'Only unsettled deposits and withdrawals can be checked', 409);
  }
  const outcome = await checkRailNow(txn);
  await audit({ actorId: req.admin!.id, action: 'RAIL_STATUS_CHECKED', entityType: 'Transaction', entityId: txn.id, after: { outcome } });
  const updated = await prisma.transaction.findUniqueOrThrow({ relationLoadStrategy: 'join', where: { id: txn.id }, include: transactionListInclude });
  res.json({ outcome, transaction: await presentTransaction(updated) });
});

/** Raw provider callbacks for a transaction, for disputes and reconciliation. */
railsRouter.get('/rails/:id/events', requirePermission('rails:manage'), async (req, res) => {
  const events = await prisma.providerEvent.findMany({ where: { transactionId: String(req.params.id) }, orderBy: { id: 'asc' } });
  res.json({ items: events.map((e) => ({ ...e, id: e.id.toString() })) });
});
