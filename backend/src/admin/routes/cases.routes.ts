import { Router } from 'express';
import { Prisma, SupportCaseCategory, SupportCasePriority, SupportCaseStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { newTransactionReference } from '../../lib/reference';
import { audit } from '../audit';
import { requirePermission } from '../auth';
import { displayName, pageParams } from '../present';

export const casesRouter = Router();

const newCaseReference = () => newTransactionReference().replace('SPX-', 'CS-');

const caseInclude = {
  user: { select: { id: true, phoneNumber: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
  transaction: { select: { id: true, reference: true, status: true, type: true } },
  createdBy: { select: { id: true, fullName: true } },
  assignedTo: { select: { id: true, fullName: true } },
} satisfies Prisma.SupportCaseInclude;

function presentCase(c: Prisma.SupportCaseGetPayload<{ include: typeof caseInclude }>) {
  return {
    id: c.id,
    reference: c.reference,
    subject: c.subject,
    category: c.category,
    priority: c.priority,
    status: c.status,
    customer: { id: c.user.id, name: displayName(c.user), phoneNumber: c.user.phoneNumber },
    transaction: c.transaction,
    createdBy: c.createdBy,
    assignedTo: c.assignedTo,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    resolvedAt: c.resolvedAt,
  };
}

/** Case queue. `mine=1` shows cases assigned to the signed-in agent; `open=1` hides resolved/closed. */
casesRouter.get('/cases', requirePermission('cases:view'), async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req.query);
  const status = z.nativeEnum(SupportCaseStatus).optional().parse(req.query.status || undefined);
  const where: Prisma.SupportCaseWhereInput = {
    ...(status ? { status } : {}),
    ...(req.query.open === '1' ? { status: { in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } } : {}),
    ...(req.query.mine === '1' ? { assignedToId: req.admin!.id } : {}),
    ...(req.query.userId ? { userId: String(req.query.userId) } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.supportCase.count({ where }),
    prisma.supportCase.findMany({ relationLoadStrategy: 'join',
      where,
      skip,
      take,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: caseInclude,
    }),
  ]);
  res.json({ page, pageSize, total, items: items.map(presentCase) });
});

const createSchema = z.object({
  userId: z.string().uuid(),
  transactionReference: z.string().trim().optional(),
  category: z.nativeEnum(SupportCaseCategory),
  priority: z.nativeEnum(SupportCasePriority).default('NORMAL'),
  subject: z.string().trim().min(5).max(160),
  note: z.string().trim().min(1).max(4000),
});

casesRouter.post('/cases', requirePermission('cases:manage'), async (req, res) => {
  const input = createSchema.parse(req.body);
  const user = await prisma.user.findUnique({ relationLoadStrategy: 'join', where: { id: input.userId } });
  if (!user) throw new AppError('CUSTOMER_NOT_FOUND', 'Customer not found', 404);

  let transactionId: string | undefined;
  if (input.transactionReference) {
    const txn = await prisma.transaction.findUnique({ relationLoadStrategy: 'join', where: { reference: input.transactionReference.toUpperCase() } });
    if (!txn) throw new AppError('TRANSACTION_NOT_FOUND', `No transaction ${input.transactionReference}`, 404);
    transactionId = txn.id;
  }

  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.supportCase.create({
      data: {
        reference: newCaseReference(),
        userId: user.id,
        transactionId,
        category: input.category,
        priority: input.priority,
        subject: input.subject,
        createdById: req.admin!.id,
        assignedToId: req.admin!.id,
        notes: { create: { authorId: req.admin!.id, body: input.note } },
      },
      include: caseInclude,
    });
    await audit({ actorId: req.admin!.id, action: 'CASE_OPENED', entityType: 'SupportCase', entityId: c.id, after: { reference: c.reference } }, tx);
    return c;
  });
  res.status(201).json(presentCase(created));
});

casesRouter.get('/cases/:id', requirePermission('cases:view'), async (req, res) => {
  const c = await prisma.supportCase.findUnique({ relationLoadStrategy: 'join',
    where: { id: String(req.params.id) },
    include: {
      ...caseInclude,
      notes: { orderBy: { createdAt: 'asc' }, include: { author: { select: { fullName: true, role: true } } } },
      approvals: {
        orderBy: { createdAt: 'desc' },
        include: { requestedBy: { select: { fullName: true } }, decidedBy: { select: { fullName: true } } },
      },
    },
  });
  if (!c) throw new AppError('CASE_NOT_FOUND', 'Case not found', 404);
  res.json({
    ...presentCase(c),
    notes: c.notes.map((n) => ({ id: n.id, body: n.body, author: n.author.fullName, role: n.author.role, createdAt: n.createdAt })),
    approvals: c.approvals.map((a) => ({
      id: a.id,
      status: a.status,
      reason: a.reason,
      requestedBy: a.requestedBy.fullName,
      decidedBy: a.decidedBy?.fullName ?? null,
      decisionNote: a.decisionNote,
      createdAt: a.createdAt,
    })),
  });
});

casesRouter.post('/cases/:id/notes', requirePermission('cases:manage'), async (req, res) => {
  const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).parse(req.body);
  const c = await prisma.supportCase.findUnique({ relationLoadStrategy: 'join', where: { id: String(req.params.id) } });
  if (!c) throw new AppError('CASE_NOT_FOUND', 'Case not found', 404);
  const note = await prisma.supportCaseNote.create({ data: { caseId: c.id, authorId: req.admin!.id, body } });
  await prisma.supportCase.update({ where: { id: c.id }, data: { updatedAt: new Date() } });
  res.status(201).json(note);
});

const updateSchema = z.object({
  status: z.nativeEnum(SupportCaseStatus).optional(),
  priority: z.nativeEnum(SupportCasePriority).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
});

casesRouter.patch('/cases/:id', requirePermission('cases:manage'), async (req, res) => {
  const input = updateSchema.parse(req.body);
  const before = await prisma.supportCase.findUnique({ relationLoadStrategy: 'join', where: { id: String(req.params.id) } });
  if (!before) throw new AppError('CASE_NOT_FOUND', 'Case not found', 404);

  const resolving = input.status && ['RESOLVED', 'CLOSED'].includes(input.status);
  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.supportCase.update({
      where: { id: before.id },
      data: { ...input, resolvedAt: resolving ? new Date() : input.status ? null : undefined },
      include: caseInclude,
    });
    await audit(
      {
        actorId: req.admin!.id,
        action: 'CASE_UPDATED',
        entityType: 'SupportCase',
        entityId: c.id,
        before: { status: before.status, priority: before.priority, assignedToId: before.assignedToId },
        after: input,
      },
      tx,
    );
    return c;
  });
  res.json(presentCase(updated));
});

/** Staff directory for case assignment. */
casesRouter.get('/staff', requirePermission('cases:view'), async (_req, res) => {
  const staff = await prisma.adminUser.findMany({
    where: { isActive: true },
    select: { id: true, fullName: true, role: true },
    orderBy: { fullName: 'asc' },
  });
  res.json(staff);
});
