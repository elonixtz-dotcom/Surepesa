import { Router } from 'express';
import { z } from 'zod';
import { EscrowDisputeStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { requirePermission } from '../auth';
import { pageParams } from '../present';
import { reconcileEscrowCustody, resolveDispute } from '../../modules/escrow/escrow.service';

/**
 * Admin escrow endpoints (blueprint §10): dispute review/resolution and custody
 * reconciliation. Dispute resolution is an authorised, audited decision — never a
 * silent override: every resolution writes an audit log entry and posts through the
 * same ledger as any other payout.
 */
export const escrowAdminRouter = Router();

escrowAdminRouter.get('/escrow/disputes', requirePermission('escrow:view'), async (req, res) => {
  const { page, pageSize, skip } = pageParams(req.query);
  const where: Prisma.EscrowDisputeWhereInput = req.query.status
    ? { status: String(req.query.status) as EscrowDisputeStatus }
    : {};
  const [items, total] = await Promise.all([
    prisma.escrowDispute.findMany({
      where,
      include: { case: true, openedBy: { include: { profile: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.escrowDispute.count({ where }),
  ]);
  res.json({
    items: items.map((d) => ({
      id: d.id,
      caseId: d.caseId,
      caseReference: d.case.reference,
      caseStatus: d.case.status,
      amountMinor: d.case.amount.toString(),
      currencyCode: d.case.currencyCode,
      itemDescription: d.case.itemDescription,
      reason: d.reason,
      requestedOutcome: d.requestedOutcome,
      status: d.status,
      openedBy: d.openedBy.profile ? `${d.openedBy.profile.firstName} ${d.openedBy.profile.lastName}` : d.openedBy.phoneNumber,
      createdAt: d.createdAt,
    })),
    total,
    page,
    pageSize,
  });
});

escrowAdminRouter.get('/escrow/disputes/:id', requirePermission('escrow:view'), async (req, res) => {
  const dispute = await prisma.escrowDispute.findUniqueOrThrow({
    where: { id: String(req.params.id) },
    include: {
      case: { include: { evidence: true, events: { orderBy: { id: 'asc' } }, escrowWallet: true } },
      openedBy: { include: { profile: true } },
    },
  });
  res.json(dispute);
});

/** Authorised resolution: releases to the seller or refunds the buyer, fully audited. */
escrowAdminRouter.post('/escrow/disputes/:id/resolve', requirePermission('escrow:resolve'), async (req, res) => {
  const input = z
    .object({
      outcome: z.enum(['RELEASE_TO_SELLER', 'REFUND_BUYER']),
      note: z.string().trim().min(10).max(1000),
    })
    .parse(req.body);
  const resolved = await resolveDispute(req.admin!.id, String(req.params.id), input);
  res.json({ caseId: resolved.id, status: resolved.status });
});

/** Records a custody reconciliation snapshot for Finance. */
escrowAdminRouter.post('/escrow/reconciliations', requirePermission('escrow:reconcile'), async (req, res) => {
  const input = z
    .object({ custodyAccountId: z.string().uuid(), statementTotal: z.string().regex(/^\d{1,18}$/) })
    .parse(req.body);
  const row = await reconcileEscrowCustody(input.custodyAccountId, BigInt(input.statementTotal), req.admin!.id);
  res.status(201).json({
    id: row.id,
    statementTotal: row.statementTotal.toString(),
    internalHeldTotal: row.internalHeldTotal.toString(),
    difference: row.difference.toString(),
  });
});
