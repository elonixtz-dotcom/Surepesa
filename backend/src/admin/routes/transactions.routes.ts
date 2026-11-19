import { Router } from 'express';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../auth';
import { money, pageParams, presentTransaction, transactionListInclude, walletLabel, walletOwnerInclude } from '../present';

export const transactionsRouter = Router();

const filterSchema = z.object({
  q: z.string().trim().optional(),
  status: z.nativeEnum(TransactionStatus).optional(),
  type: z.nativeEnum(TransactionType).optional(),
});

/** Transaction monitor with filters; `q` matches an SPX reference or a customer's phone. */
transactionsRouter.get('/transactions', requirePermission('transactions:view'), async (req, res) => {
  const { q, status, type } = filterSchema.parse(req.query);
  const { skip, take, page, pageSize } = pageParams(req.query);

  const where: Prisma.TransactionWhereInput = { ...(status ? { status } : {}), ...(type ? { type } : {}) };
  if (q) {
    const digits = q.replace(/\D/g, '').replace(/^0/, '');
    const phoneMatch: Prisma.WalletWhereInput = { user: { phoneNumber: { contains: digits } } };
    where.OR = [
      { reference: { contains: q.toUpperCase() } },
      ...(digits.length >= 4 ? [{ sourceWallet: phoneMatch }, { destinationWallet: phoneMatch }] : []),
    ];
  }

  const [total, items] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({ relationLoadStrategy: 'join', where, skip, take, orderBy: { createdAt: 'desc' }, include: transactionListInclude }),
  ]);
  res.json({ page, pageSize, total, items: await Promise.all(items.map(presentTransaction)) });
});

/** Full transaction record: status timeline, ledger postings, reversal links, cases and approvals. */
transactionsRouter.get('/transactions/:id', requirePermission('transactions:view'), async (req, res) => {
  const id = String(req.params.id);
  const txn = await prisma.transaction.findFirst({ relationLoadStrategy: 'join',
    where: { OR: [{ id: z.string().uuid().safeParse(id).success ? id : undefined }, { reference: id.toUpperCase() }] },
    include: {
      ...transactionListInclude,
      events: { orderBy: { id: 'asc' } },
      ledgerEntries: { orderBy: { id: 'asc' }, include: { wallet: { include: walletOwnerInclude } } },
      reverses: { select: { id: true, reference: true } },
      reversedBy: { select: { id: true, reference: true, createdAt: true, description: true } },
      supportCases: { select: { id: true, reference: true, subject: true, status: true } },
      approvals: {
        orderBy: { createdAt: 'desc' },
        include: { requestedBy: { select: { fullName: true } }, decidedBy: { select: { fullName: true } } },
      },
    },
  });
  if (!txn) throw new AppError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404);

  res.json({
    ...(await presentTransaction(txn)),
    providerReference: txn.providerReference,
    idempotencyKey: txn.idempotencyKey,
    reverses: txn.reverses,
    reversedBy: txn.reversedBy,
    events: txn.events.map((e) => ({
      id: e.id.toString(),
      from: e.fromStatus,
      to: e.toStatus,
      actorType: e.actorType,
      note: e.note,
      at: e.createdAt,
    })),
    ledger: await Promise.all(
      txn.ledgerEntries.map(async (e) => ({
        id: e.id.toString(),
        account: walletLabel(e.wallet),
        entryType: e.entryType,
        amount: await money(e.amount, e.currencyCode),
        balanceAfter: await money(e.balanceAfter, e.currencyCode),
      })),
    ),
    cases: txn.supportCases,
    approvals: txn.approvals.map((a) => ({
      id: a.id,
      type: a.type,
      status: a.status,
      reason: a.reason,
      requestedBy: a.requestedBy.fullName,
      decidedBy: a.decidedBy?.fullName ?? null,
      decisionNote: a.decisionNote,
      createdAt: a.createdAt,
      decidedAt: a.decidedAt,
    })),
  });
});
