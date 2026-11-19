import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { payMerchant, sendMoney } from '../services/payment.service';
import { verifyTransactionPin } from '../services/pin.service';

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const transferSchema = z.object({
  recipientUserId: z.string().uuid(),
  amountMinor: z.string().regex(/^[1-9]\d{0,17}$/),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).default('TZS'),
  idempotencyKey: z.string().min(8).max(128),
  pin: z.string().regex(/^\d{6}$/),
  description: z.string().trim().max(160).optional(),
});
const merchantSchema = z.object({
  businessId: z.string().uuid(),
  amountMinor: z.string().regex(/^[1-9]\d{0,17}$/),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).default('TZS'),
  idempotencyKey: z.string().min(8).max(128),
  pin: z.string().regex(/^\d{6}$/),
  description: z.string().trim().max(160).optional(),
});

function publicTransaction(txn: {
  id: string; reference: string; type: string; status: string; amount: bigint;
  currencyCode: string; fee: bigint; description: string | null;
  createdAt: Date; completedAt: Date | null; failureCode: string | null;
}) {
  return {
    id: txn.id, reference: txn.reference, type: txn.type, status: txn.status,
    amountMinor: txn.amount.toString(), currencyCode: txn.currencyCode,
    feeMinor: txn.fee.toString(), description: txn.description,
    failureCode: txn.failureCode, createdAt: txn.createdAt, completedAt: txn.completedAt,
  };
}

paymentsRouter.post('/transfers', async (req, res) => {
  const input = transferSchema.parse(req.body);
  await verifyTransactionPin(req.user!.id, input.pin);
  const txn = await sendMoney({
    senderUserId: req.user!.id, recipientUserId: input.recipientUserId,
    amount: BigInt(input.amountMinor), currency: input.currencyCode,
    idempotencyKey: input.idempotencyKey, description: input.description,
  });
  res.status(txn.status === 'SUCCESS' ? 201 : 422).json(publicTransaction(txn));
});

paymentsRouter.post('/merchant-payments', async (req, res) => {
  const input = merchantSchema.parse(req.body);
  await verifyTransactionPin(req.user!.id, input.pin);
  const txn = await payMerchant({
    payerUserId: req.user!.id, businessId: input.businessId,
    amount: BigInt(input.amountMinor), currency: input.currencyCode,
    idempotencyKey: input.idempotencyKey, description: input.description,
  });
  res.status(txn.status === 'SUCCESS' ? 201 : 422).json(publicTransaction(txn));
});

paymentsRouter.get('/transactions', async (req, res) => {
  const query = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  }).parse(req.query);
  const userId = req.user!.id;
  const where = {
    OR: [
      { initiatorUserId: userId },
      { sourceWallet: { is: { userId } } },
      { destinationWallet: { is: { userId } } },
    ],
  };
  const [items, total] = await Promise.all([
    prisma.transaction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit, skip: query.offset }),
    prisma.transaction.count({ where }),
  ]);
  res.json({ items: items.map(publicTransaction), total, limit: query.limit, offset: query.offset });
});

paymentsRouter.get('/transactions/:id', async (req, res) => {
  const txn = await prisma.transaction.findUnique({
    where: { id: String(req.params.id) },
    include: { sourceWallet: true, destinationWallet: true },
  });
  if (!txn) throw new AppError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404);
  const userId = req.user!.id;
  const ownsIt = txn.initiatorUserId === userId || txn.sourceWallet?.userId === userId || txn.destinationWallet?.userId === userId;
  if (!ownsIt) throw new AppError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404);
  res.json(publicTransaction(txn));
});
