import { Request, Router } from 'express';
import { PushBillSession } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { toMinorUnits } from '../../lib/money';
import { requireAuth } from '../../middleware/auth';
import { displayMoney, minorUnitsOf } from '../../services/receipt.service';
import {
  acceptPushBill,
  authorisePushBill,
  cancelPushBill,
  confirmPushBill,
  createPushBill,
  declinePushBill,
  getPushBill,
  listPushBills,
  requestCall,
} from './pushbill.service';

/**
 * PushBill ★ (blueprint §6): /v1/pushbills
 *
 * A requester asks another SurePesa user to pay a merchant/agent. The payment is authorised
 * only after a bridged cellular call and both parties' explicit confirmations. Session money
 * never moves outside authorise(); every endpoint returns the session, never a raw balance.
 */
export const pushBillRouter = Router();
pushBillRouter.use(requireAuth);

const phone = z.string().regex(/^\+255[67]\d{8}$/, 'Use the format +2557XXXXXXXX');
const pin = z.string().regex(/^\d{4,6}$/, 'Enter your 4 to 6 digit PIN');

function idempotencyKey(req: Request): string {
  const key = req.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 100) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header (8–100 characters)', 400);
  }
  return key;
}

async function present(session: PushBillSession, viewerId: string) {
  return {
    id: session.id,
    reference: session.reference,
    state: session.state,
    role: session.requesterId === viewerId ? 'REQUESTER' : 'PAYER',
    destination: {
      kind: session.destinationKind,
      label: session.destinationLabel,
    },
    amount: await displayMoney(session.amount, session.currencyCode),
    note: session.note,
    expiresAt: session.expiresAt,
    paidTransactionId: session.paymentTransactionId,
    createdAt: session.createdAt,
  };
}

pushBillRouter.post('/', async (req, res) => {
  const input = z
    .object({
      destinationKind: z.enum(['QR_CODE', 'MERCHANT_CODE', 'AGENT_NUMBER']),
      destination: z.string().trim().min(3).max(64),
      payerPhone: phone,
      amount: z.string().trim().min(1).max(20),
      note: z.string().trim().max(140).optional(),
    })
    .parse(req.body);
  const minor = toMinorUnits(input.amount, await minorUnitsOf('TZS'));
  if (minor <= 0n) throw new AppError('INVALID_AMOUNT', 'Enter a valid amount greater than zero', 400);
  const session = await createPushBill({
    requesterId: req.user!.id,
    destinationKind: input.destinationKind,
    destination: input.destination,
    payerPhone: input.payerPhone,
    amount: minor,
    note: input.note,
    idempotencyKey: idempotencyKey(req),
  });
  res.status(201).json(await present(session, req.user!.id));
});

pushBillRouter.get('/', async (req, res) => {
  const { limit, before } = z
    .object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.coerce.date().optional() })
    .parse(req.query);
  const items = await listPushBills(req.user!.id, before, limit);
  res.json({
    items: await Promise.all(items.map((s) => present(s, req.user!.id))),
    next: items.length === limit ? items[items.length - 1]!.createdAt : null,
  });
});

pushBillRouter.get('/:id', async (req, res) => {
  const session = await getPushBill(req.user!.id, String(req.params.id));
  res.json(await present(session, req.user!.id));
});

/** Payer agrees to proceed to the call. */
pushBillRouter.post('/:id/accept', async (req, res) => {
  res.json(await present(await acceptPushBill(req.user!.id, String(req.params.id)), req.user!.id));
});

pushBillRouter.post('/:id/decline', async (req, res) => {
  res.json(await present(await declinePushBill(req.user!.id, String(req.params.id)), req.user!.id));
});

pushBillRouter.post('/:id/cancel', async (req, res) => {
  res.json(await present(await cancelPushBill(req.user!.id, String(req.params.id)), req.user!.id));
});

/** Either participant triggers the bridged cellular call once the payer accepted. */
pushBillRouter.post('/:id/call', async (req, res) => {
  const { session, providerCallId } = await requestCall(req.user!.id, String(req.params.id));
  res.json({ ...(await present(session, req.user!.id)), providerCallId });
});

pushBillRouter.post('/:id/confirm', async (req, res) => {
  const input = z
    .object({
      method: z.enum(['IN_APP', 'USSD']).default('IN_APP'),
      result: z.enum(['CONFIRMED', 'REJECTED', 'MISMATCH']),
    })
    .parse(req.body);
  res.json(await present(await confirmPushBill(req.user!.id, String(req.params.id), input.method, input.result), req.user!.id));
});

/** The only endpoint that can move money: payer's PIN + idempotency key, after the call. */
pushBillRouter.post('/:id/authorize', async (req, res) => {
  const input = z.object({ pin }).parse(req.body);
  const session = await authorisePushBill(req.user!.id, String(req.params.id), input.pin, idempotencyKey(req));
  res.json(await present(session, req.user!.id));
});
