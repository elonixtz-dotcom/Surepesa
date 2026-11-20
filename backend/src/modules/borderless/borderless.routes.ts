import { Request, Router } from 'express';
import { CrossBorderTransfer, FxQuote } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import {
  acceptQuote,
  createQuote,
  executeTransfer,
  getTransfer,
  listCorridors,
  listTransfers,
} from './borderless.service';

/**
 * Borderless Payments (blueprint §7): /v1/borderless
 *
 * Corridor availability is data-driven; FX quotes are short-lived and executed exactly
 * once. Unsupported routes are unavailable — never simulated as live.
 */
export const borderlessRouter = Router();
borderlessRouter.use(requireAuth);

const phone = z.string().regex(/^\+255[67]\d{8}$/, 'Use the format +2557XXXXXXXX');
const pin = z.string().regex(/^\d{4,6}$/, 'Enter your 4 to 6 digit PIN');

function idempotencyKey(req: Request): string {
  const key = req.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 100) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header (8–100 characters)', 400);
  }
  return key;
}

function presentQuote(q: FxQuote) {
  return {
    id: q.id,
    corridorId: q.corridorId,
    sourceAmountMinor: q.sourceAmount.toString(),
    sourceCurrency: q.sourceCurrency,
    destinationAmountMinor: q.destinationAmount.toString(),
    destinationCurrency: q.destinationCurrency,
    rate: q.rate.toString(),
    feeMinor: q.feeAmount.toString(),
    providerName: q.providerName,
    status: q.status,
    expiresAt: q.expiresAt,
  };
}

function presentTransfer(t: CrossBorderTransfer, viewerId: string) {
  return {
    id: t.id,
    reference: t.reference,
    status: t.status,
    role: t.senderId === viewerId ? 'SENDER' : 'RECIPIENT',
    recipientCountry: t.recipientCountry,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
  };
}

borderlessRouter.get('/corridors', async (_req, res) => {
  const corridors = await listCorridors();
  res.json({
    items: corridors.map((c) => ({
      id: c.id,
      originCountry: c.originCountry,
      destinationCountry: c.destinationCountry,
      sourceCurrency: c.sourceCurrency,
      destinationCurrency: c.destinationCurrency,
      allowedTypes: c.allowedTypes,
      providerName: c.providerName,
      minAmountMinor: c.minAmount.toString(),
      maxAmountMinor: c.maxAmount.toString(),
    })),
  });
});

borderlessRouter.post('/quotes', async (req, res) => {
  const input = z
    .object({ corridorId: z.string().uuid(), sourceAmount: z.string().regex(/^[1-9]\d{0,17}$/) })
    .parse(req.body);
  res.status(201).json(presentQuote(await createQuote(req.user!.id, input.corridorId, BigInt(input.sourceAmount))));
});

borderlessRouter.post('/quotes/:id/accept', async (req, res) => {
  res.json(presentQuote(await acceptQuote(req.user!.id, String(req.params.id))));
});

borderlessRouter.post('/transfers', async (req, res) => {
  const input = z.object({ quoteId: z.string().uuid(), recipientPhone: phone, pin }).parse(req.body);
  const transfer = await executeTransfer(req.user!.id, input.quoteId, input.recipientPhone, input.pin, idempotencyKey(req));
  res.status(201).json(presentTransfer(transfer, req.user!.id));
});

borderlessRouter.get('/transfers', async (req, res) => {
  const { limit, before } = z
    .object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.coerce.date().optional() })
    .parse(req.query);
  const items = await listTransfers(req.user!.id, before, limit);
  res.json({
    items: items.map((t) => ({
      ...presentTransfer(t, req.user!.id),
      sourceAmountMinor: t.quote.sourceAmount.toString(),
      sourceCurrency: t.quote.sourceCurrency,
      destinationAmountMinor: t.quote.destinationAmount.toString(),
      destinationCurrency: t.quote.destinationCurrency,
      rate: t.quote.rate.toString(),
      feeMinor: t.quote.feeAmount.toString(),
    })),
    next: items.length === limit ? items[items.length - 1]!.createdAt : null,
  });
});

borderlessRouter.get('/transfers/:id', async (req, res) => {
  const t = await getTransfer(req.user!.id, String(req.params.id));
  res.json({
    ...presentTransfer(t, req.user!.id),
    sourceAmountMinor: t.quote.sourceAmount.toString(),
    sourceCurrency: t.quote.sourceCurrency,
    destinationAmountMinor: t.quote.destinationAmount.toString(),
    destinationCurrency: t.quote.destinationCurrency,
    rate: t.quote.rate.toString(),
    feeMinor: t.quote.feeAmount.toString(),
    providerName: t.corridor.providerName,
    settlements: t.settlements.map((s) => ({
      reference: s.reference, amountMinor: s.amount.toString(), currencyCode: s.currencyCode, status: s.status, valueDate: s.valueDate,
    })),
  });
});
