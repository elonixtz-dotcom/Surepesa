import { Router } from 'express';
import { ApprovalStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { refundableAmount, refundPayment, reverseTransaction } from '../../services/payment.service';
import { audit } from '../audit';
import { requirePermission } from '../auth';
import { pageParams, presentTransaction, transactionListInclude } from '../present';

/**
 * Maker-checker for money-moving back-office actions (SOP §9 segregation of duties).
 * Customer Service *requests* a reversal or a (partial) refund; Finance or the System
 * Controller decides it.
 * Nobody can decide a request they raised.
 */
export const approvalsRouter = Router();

const approvalInclude = {
  transaction: { include: transactionListInclude },
  case: { select: { id: true, reference: true, subject: true } },
  requestedBy: { select: { id: true, fullName: true, role: true } },
  decidedBy: { select: { id: true, fullName: true } },
} as const;

type ApprovalWithRelations = Awaited<ReturnType<typeof loadApproval>>;

function loadApproval(id: string) {
  return prisma.approvalRequest.findUnique({ relationLoadStrategy: 'join', where: { id }, include: approvalInclude });
}

async function present(a: NonNullable<ApprovalWithRelations>) {
  return {
    id: a.id,
    type: a.type,
    status: a.status,
    amount: a.amount,
    reason: a.reason,
    transaction: a.transaction ? await presentTransaction(a.transaction) : null,
    case: a.case,
    requestedBy: a.requestedBy,
    decidedBy: a.decidedBy,
    decisionNote: a.decisionNote,
    createdAt: a.createdAt,
    decidedAt: a.decidedAt,
  };
}

approvalsRouter.get('/approvals', requirePermission('approvals:request'), async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const status = z.nativeEnum(ApprovalStatus).optional().parse(req.query.status || undefined);
  const where = status ? { status } : {};
  const [total, items] = await Promise.all([
    prisma.approvalRequest.count({ where }),
    prisma.approvalRequest.findMany({ relationLoadStrategy: 'join', where, skip, take, orderBy: { createdAt: 'desc' }, include: approvalInclude }),
  ]);
  res.json({ page, pageSize, total, items: await Promise.all(items.map(present)) });
});

const requestSchema = z.object({
  type: z.enum(['TRANSACTION_REVERSAL', 'TRANSACTION_REFUND']).default('TRANSACTION_REVERSAL'),
  transactionId: z.string().uuid(),
  /** TRANSACTION_REFUND only: minor units as a string ("500000" = TZS 5,000.00). */
  amount: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .transform((v) => BigInt(v))
    .optional(),
  caseId: z.string().uuid().optional(),
  reason: z.string().trim().min(10).max(1000),
});

/**
 * Request a reversal (whole transaction) or a refund (all or part of a merchant payment).
 * The transaction must be SUCCESS and have no open request.
 */
approvalsRouter.post('/approvals', requirePermission('approvals:request'), async (req, res) => {
  const input = requestSchema.parse(req.body);
  const txn = await prisma.transaction.findUnique({ relationLoadStrategy: 'join', where: { id: input.transactionId }, include: { reversedBy: true } });
  if (!txn) throw new AppError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404);
  if (input.type === 'TRANSACTION_REFUND') {
    if (!input.amount) throw new AppError('AMOUNT_REQUIRED', 'Enter the amount to refund', 400);
    const remaining = await refundableAmount(txn.id);
    if (remaining === 0n) {
      throw new AppError('NOT_REFUNDABLE', 'Only successful merchant payments with an amount left can be refunded', 409);
    }
    if (input.amount > remaining) {
      throw new AppError('REFUND_EXCEEDS_PAYMENT', 'Refund is larger than the amount left to refund', 409, { remaining: remaining.toString() });
    }
  } else if (txn.status !== 'SUCCESS' || txn.reversedBy || txn.type === 'REVERSAL' || txn.type === 'REFUND') {
    throw new AppError('NOT_REVERSIBLE', `A ${txn.status.toLowerCase()} ${txn.type.toLowerCase()} cannot be reversed`, 409);
  }
  const open = await prisma.approvalRequest.findFirst({ relationLoadStrategy: 'join', where: { transactionId: txn.id, status: 'PENDING' } });
  if (open) throw new AppError('REQUEST_EXISTS', 'A request for this transaction is already pending', 409);
  const label = input.type === 'TRANSACTION_REFUND' ? `Refund of ${input.amount} minor units` : 'Reversal';

  const created = await prisma.$transaction(async (tx) => {
    const a = await tx.approvalRequest.create({
      data: {
        type: input.type,
        transactionId: txn.id,
        amount: input.type === 'TRANSACTION_REFUND' ? input.amount : undefined,
        caseId: input.caseId,
        reason: input.reason,
        requestedById: req.admin!.id,
      },
    });
    if (input.caseId) {
      await tx.supportCaseNote.create({
        data: { caseId: input.caseId, authorId: req.admin!.id, body: `${label} requested for ${txn.reference}: ${input.reason}` },
      });
      await tx.supportCase.update({ where: { id: input.caseId }, data: { status: 'ESCALATED' } });
    }
    await audit(
      {
        actorId: req.admin!.id,
        action: input.type === 'TRANSACTION_REFUND' ? 'REFUND_REQUESTED' : 'REVERSAL_REQUESTED',
        entityType: 'Transaction',
        entityId: txn.id,
        after: { approvalId: a.id, reason: input.reason, ...(input.amount ? { amount: input.amount.toString() } : {}) },
      },
      tx,
    );
    return a;
  });
  res.status(201).json(await present((await loadApproval(created.id))!));
});

const decisionSchema = z.object({ note: z.string().trim().max(1000).optional() });

async function loadPendingForDecision(id: string, adminId: string) {
  const approval = await loadApproval(id);
  if (!approval) throw new AppError('APPROVAL_NOT_FOUND', 'Request not found', 404);
  if (approval.status !== 'PENDING') throw new AppError('ALREADY_DECIDED', `Request is already ${approval.status.toLowerCase()}`, 409);
  if (approval.requestedById === adminId) {
    throw new AppError('SELF_APPROVAL', 'You cannot decide a request you raised. Another approver must review it.', 403);
  }
  return approval;
}

approvalsRouter.post('/approvals/:id/approve', requirePermission('approvals:decide'), async (req, res) => {
  const { note } = decisionSchema.parse(req.body);
  const approval = await loadPendingForDecision(String(req.params.id), req.admin!.id);

  // Move the money first; if the reversal is refused (e.g. the receiver already spent the
  // funds) the request stays PENDING and the error is shown to the approver.
  const actor = { type: 'ADMIN' as const, id: req.admin!.id };
  const isRefund = approval.type === 'TRANSACTION_REFUND';
  const reversal = isRefund
    ? await refundPayment({ transactionId: approval.transactionId!, amount: approval.amount!, actor, reason: `Approved refund: ${approval.reason}` })
    : await reverseTransaction(approval.transactionId!, { actor, reason: `Approved reversal: ${approval.reason}` });

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.approvalRequest.updateMany({
      where: { id: approval.id, status: 'PENDING' },
      data: { status: 'APPROVED', decidedById: req.admin!.id, decidedAt: new Date(), decisionNote: note },
    });
    if (count !== 1) throw new AppError('ALREADY_DECIDED', 'Request was decided by someone else', 409);
    if (approval.caseId) {
      await tx.supportCaseNote.create({
        data: { caseId: approval.caseId, authorId: req.admin!.id, body: `${isRefund ? 'Refund' : 'Reversal'} approved. Refund reference ${reversal.reference}.${note ? ` ${note}` : ''}` },
      });
    }
    await audit({ actorId: req.admin!.id, action: isRefund ? 'REFUND_APPROVED' : 'REVERSAL_APPROVED', entityType: 'ApprovalRequest', entityId: approval.id, after: { reversalReference: reversal.reference, note } }, tx);
  });
  res.json(await present((await loadApproval(approval.id))!));
});

approvalsRouter.post('/approvals/:id/reject', requirePermission('approvals:decide'), async (req, res) => {
  const { note } = z.object({ note: z.string().trim().min(5).max(1000) }).parse(req.body);
  const approval = await loadPendingForDecision(String(req.params.id), req.admin!.id);

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.approvalRequest.updateMany({
      where: { id: approval.id, status: 'PENDING' },
      data: { status: 'REJECTED', decidedById: req.admin!.id, decidedAt: new Date(), decisionNote: note },
    });
    if (count !== 1) throw new AppError('ALREADY_DECIDED', 'Request was decided by someone else', 409);
    if (approval.caseId) {
      await tx.supportCaseNote.create({ data: { caseId: approval.caseId, authorId: req.admin!.id, body: `Reversal rejected: ${note}` } });
      await tx.supportCase.update({ where: { id: approval.caseId }, data: { status: 'IN_PROGRESS' } });
    }
    await audit({ actorId: req.admin!.id, action: 'REVERSAL_REJECTED', entityType: 'ApprovalRequest', entityId: approval.id, after: { note } }, tx);
  });
  res.json(await present((await loadApproval(approval.id))!));
});

