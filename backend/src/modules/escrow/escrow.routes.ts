import { Request, Router } from 'express';
import { EscrowCase } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import {
  acceptTerms,
  agreeRefund,
  cancelCase,
  confirmReceipt,
  createEscrowCase,
  declineTerms,
  fundCase,
  getEscrowCase,
  getEscrowWalletSummary,
  listEscrowCases,
  markDelivered,
  markFulfilment,
  openDispute,
  submitEvidence,
} from './escrow.service';

/**
 * SurePesa Escrow ★ (blueprint §10): /v1/escrow
 *
 * Protected buyer/seller deals. Funds sit in a dedicated per-deal ESCROW_HOLDING wallet
 * that no other endpoint can debit. There is deliberately no generic send/withdraw
 * endpoint for escrow wallets — only release and refund, after an authorised decision.
 */
export const escrowRouter = Router();
escrowRouter.use(requireAuth);

const phone = z.string().regex(/^\+255[67]\d{8}$/, 'Use the format +2557XXXXXXXX');
const amount = z.string().regex(/^[1-9]\d{0,17}$/, 'Enter a valid amount');
const pin = z.string().regex(/^\d{4,6}$/, 'Enter your 4 to 6 digit PIN');

function idempotencyKey(req: Request): string {
  const key = req.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 100) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header (8–100 characters)', 400);
  }
  return key;
}

function present(c: EscrowCase, viewerId: string) {
  return {
    id: c.id,
    reference: c.reference,
    status: c.status,
    role: c.buyerId === viewerId ? 'BUYER' : 'SELLER',
    itemDescription: c.itemDescription,
    amountMinor: c.amount.toString(),
    feeMinor: c.feeAmount.toString(),
    currencyCode: c.currencyCode,
    fundingDeadline: c.fundingDeadline,
    deliveryDeadline: c.deliveryDeadline,
    inspectionDays: c.inspectionDays,
    fundedAt: c.fundedAt,
    deliveredAt: c.deliveredAt,
    releasedAt: c.releasedAt,
    refundedAt: c.refundedAt,
    createdAt: c.createdAt,
  };
}

escrowRouter.post('/cases', async (req, res) => {
  const input = z
    .object({
      sellerPhone: phone,
      itemDescription: z.string().trim().min(4).max(500),
      amount,
      currencyCode: z.string().regex(/^[A-Z]{3}$/).default('TZS'),
      deliveryDays: z.number().int().min(1).max(90).optional(),
      inspectionDays: z.number().int().min(1).max(30).optional(),
    })
    .parse(req.body);
  const created = await createEscrowCase({
    buyerId: req.user!.id,
    sellerPhone: input.sellerPhone,
    itemDescription: input.itemDescription,
    amount: BigInt(input.amount),
    currencyCode: input.currencyCode,
    deliveryDays: input.deliveryDays,
    inspectionDays: input.inspectionDays,
    idempotencyKey: idempotencyKey(req),
  });
  res.status(201).json(present(created, req.user!.id));
});

escrowRouter.get('/cases', async (req, res) => {
  const { limit, before } = z
    .object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.coerce.date().optional() })
    .parse(req.query);
  const items = await listEscrowCases(req.user!.id, before, limit);
  res.json({
    items: items.map((c) => present(c, req.user!.id)),
    next: items.length === limit ? items[items.length - 1]!.createdAt : null,
  });
});

escrowRouter.get('/cases/:id', async (req, res) => {
  const c = await getEscrowCase(req.user!.id, String(req.params.id));
  res.json({
    ...present(c, req.user!.id),
    evidence: c.evidence.map((e) => ({
      id: e.id, type: e.type, note: e.note, checksum: e.checksum, submittedBy: e.submittedBy, createdAt: e.createdAt,
    })),
    disputes: c.disputes.map((d) => ({
      id: d.id, reason: d.reason, requestedOutcome: d.requestedOutcome, status: d.status,
      resolution: d.resolution, createdAt: d.createdAt,
    })),
    payouts: c.payouts.map((p) => ({ kind: p.kind, amountMinor: p.amount.toString(), feeMinor: p.feeAmount.toString(), status: p.status })),
    events: c.events.map((e) => ({ action: e.action, from: e.fromStatus, to: e.toStatus, note: e.note, at: e.createdAt })),
    escrowWallet: c.escrowWallet
      ? { systemCode: c.escrowWallet.systemCode, heldMinor: c.escrowWallet.balance.toString(), status: c.escrowWallet.status }
      : null,
  });
});

escrowRouter.post('/cases/:id/accept-terms', async (req, res) => {
  res.json(present(await acceptTerms(req.user!.id, String(req.params.id)), req.user!.id));
});

escrowRouter.post('/cases/:id/decline', async (req, res) => {
  res.json(present(await declineTerms(req.user!.id, String(req.params.id)), req.user!.id));
});

escrowRouter.post('/cases/:id/cancel', async (req, res) => {
  res.json(present(await cancelCase(req.user!.id, String(req.params.id)), req.user!.id));
});

/** The only funding endpoint: buyer's PIN + idempotency key, wallet -> escrow holding. */
escrowRouter.post('/cases/:id/funding-intents', async (req, res) => {
  const input = z.object({ pin }).parse(req.body);
  res.json(present(await fundCase(req.user!.id, String(req.params.id), input.pin, idempotencyKey(req)), req.user!.id));
});

escrowRouter.post('/cases/:id/fulfilment', async (req, res) => {
  res.json(present(await markFulfilment(req.user!.id, String(req.params.id)), req.user!.id));
});

escrowRouter.post('/cases/:id/delivered', async (req, res) => {
  res.json(present(await markDelivered(req.user!.id, String(req.params.id)), req.user!.id));
});

escrowRouter.post('/cases/:id/evidence', async (req, res) => {
  const input = z
    .object({
      type: z.enum(['PHOTO', 'DOCUMENT', 'TRACKING', 'NOTE', 'OTHER']),
      storageKey: z.string().max(500).optional(),
      checksum: z.string().max(128).optional(),
      note: z.string().trim().max(500).optional(),
    })
    .parse(req.body);
  const ev = await submitEvidence(req.user!.id, String(req.params.id), input);
  res.status(201).json({ id: ev.id, type: ev.type, createdAt: ev.createdAt });
});

escrowRouter.post('/cases/:id/confirm-receipt', async (req, res) => {
  res.json(present(await confirmReceipt(req.user!.id, String(req.params.id)), req.user!.id));
});

escrowRouter.post('/cases/:id/refund', async (req, res) => {
  res.json(present(await agreeRefund(req.user!.id, String(req.params.id)), req.user!.id));
});

escrowRouter.post('/cases/:id/disputes', async (req, res) => {
  const input = z
    .object({
      reason: z.string().trim().min(10).max(1000),
      requestedOutcome: z.enum(['RELEASE_TO_SELLER', 'REFUND_BUYER']),
    })
    .parse(req.body);
  const dispute = await openDispute(req.user!.id, String(req.params.id), input);
  res.status(201).json({ id: dispute.id, status: dispute.status, requestedOutcome: dispute.requestedOutcome });
});

/** Read-only summary of the deal's escrow holding wallet. */
escrowRouter.get('/wallets/:id/summary', async (req, res) => {
  res.json(await getEscrowWalletSummary(req.user!.id, String(req.params.id)));
});
