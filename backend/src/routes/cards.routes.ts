import { Request, Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { toMinorUnits } from '../lib/money';
import { requireAuth } from '../middleware/auth';
import { simulatedCardIssuer } from '../providers';
import {
  closeCard,
  createCard,
  freezeCard,
  handleCardEvent,
  loadCard,
  loadOwnCard,
  presentCard,
  refreshCard,
  revealCard,
  setCardLimit,
  unloadCard,
} from '../services/card.service';
import { verifyPin } from '../services/pin.service';
import { displayMoney, loadReceipt, minorUnitsOf, presentReceipt, receiptInclude } from '../services/receipt.service';

/**
 * Virtual cards: /v1/cards
 *
 * Creating a card, moving money onto or off it, revealing its details and closing it all need
 * the transaction PIN. Card details are returned once with `Cache-Control: no-store` and are
 * never stored by SurePesa.
 */
export const cardsRouter = Router();
cardsRouter.use(requireAuth);

const pin = z.string().regex(/^\d{4,6}$/, 'Enter your 4 to 6 digit PIN');
const decimalAmount = z.string().trim().min(1).max(20);

async function toMinor(amount: string): Promise<bigint> {
  try {
    const m = toMinorUnits(amount, await minorUnitsOf('TZS'));
    if (m <= 0n) throw new RangeError('not positive');
    return m;
  } catch {
    throw new AppError('INVALID_AMOUNT', 'Enter a valid amount greater than zero', 400);
  }
}

function idempotencyKey(req: Request): string {
  const key = req.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 100) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header (8–100 characters)', 400);
  }
  return key;
}

async function view(card: Awaited<ReturnType<typeof loadOwnCard>>) {
  const c = await presentCard(card);
  const { balanceMinor, perTransactionLimitMinor, ...rest } = c;
  return {
    ...rest,
    balance: await displayMoney(balanceMinor, c.currency),
    perTransactionLimit: perTransactionLimitMinor === null ? null : await displayMoney(perTransactionLimitMinor, c.currency),
  };
}

cardsRouter.get('/', async (req, res) => {
  const cards = await prisma.virtualCard.findMany({
    where: { userId: req.user!.id, status: { not: 'FAILED' } },
    orderBy: [{ closedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
  });
  res.json({ items: await Promise.all(cards.map(view)), maxOpenCards: 3 });
});

const createSchema = z.object({
  nickname: z.string().trim().min(1).max(30),
  pin,
  validityMonths: z.union([z.literal(6), z.literal(12), z.literal(24)]).optional(),
  perTransactionLimit: decimalAmount.nullable().optional(),
  initialLoad: decimalAmount.optional(),
});

/** Issue a card, optionally loading it straight away (needs an Idempotency-Key then). */
cardsRouter.post('/', async (req, res) => {
  const input = createSchema.parse(req.body);
  const key = input.initialLoad ? idempotencyKey(req) : undefined;
  await verifyPin(req.user!.id, input.pin);
  const card = await createCard({
    userId: req.user!.id,
    nickname: input.nickname,
    validityMonths: input.validityMonths,
    perTransactionLimit: input.perTransactionLimit ? await toMinor(input.perTransactionLimit) : null,
  });
  let load = null;
  if (input.initialLoad && card.status === 'ACTIVE') {
    const txn = await loadCard(req.user!.id, card.id, await toMinor(input.initialLoad), key!);
    load = await loadReceipt(txn.id, req.user!.id);
  }
  const fresh = await prisma.virtualCard.findUniqueOrThrow({ where: { id: card.id } });
  res.status(card.status === 'FAILED' ? 422 : 201).json({ card: await view(fresh), load });
});

cardsRouter.get('/:id', async (req, res) => {
  const card = await refreshCard(req.user!.id, String(req.params.id));
  const wallet = await prisma.wallet.findUnique({ where: { cardId: card.id }, select: { id: true } });
  const txns = wallet
    ? await prisma.transaction.findMany({
        relationLoadStrategy: 'join',
        where: { OR: [{ sourceWalletId: wallet.id }, { destinationWalletId: wallet.id }] },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: receiptInclude,
      })
    : [];
  res.json({ card: await view(card), transactions: await Promise.all(txns.map((t) => presentReceipt(t, req.user!.id))) });
});

cardsRouter.post('/:id/load', async (req, res) => {
  const { amount, pin: p } = z.object({ amount: decimalAmount, pin }).parse(req.body);
  const key = idempotencyKey(req);
  await verifyPin(req.user!.id, p);
  const txn = await loadCard(req.user!.id, String(req.params.id), await toMinor(amount), key);
  res.status(201).json(await loadReceipt(txn.id, req.user!.id));
});

cardsRouter.post('/:id/unload', async (req, res) => {
  const { amount, pin: p } = z.object({ amount: decimalAmount, pin }).parse(req.body);
  const key = idempotencyKey(req);
  await verifyPin(req.user!.id, p);
  const txn = await unloadCard(req.user!.id, String(req.params.id), await toMinor(amount), key);
  res.status(201).json(await loadReceipt(txn.id, req.user!.id));
});

/** Freezing needs no PIN (it only protects the customer); unfreezing does. */
cardsRouter.post('/:id/freeze', async (req, res) => {
  res.json(await view(await freezeCard(req.user!.id, String(req.params.id), true)));
});

cardsRouter.post('/:id/unfreeze', async (req, res) => {
  const { pin: p } = z.object({ pin }).parse(req.body);
  await verifyPin(req.user!.id, p);
  res.json(await view(await freezeCard(req.user!.id, String(req.params.id), false)));
});

cardsRouter.put('/:id/limit', async (req, res) => {
  const { perTransaction } = z.object({ perTransaction: decimalAmount.nullable() }).parse(req.body);
  const card = await setCardLimit(req.user!.id, String(req.params.id), perTransaction === null ? null : await toMinor(perTransaction));
  res.json(await view(card));
});

cardsRouter.post('/:id/reveal', async (req, res) => {
  const { pin: p } = z.object({ pin }).parse(req.body);
  await verifyPin(req.user!.id, p);
  const details = await revealCard(req.user!.id, String(req.params.id), req.ip);
  res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache').json(details);
});

/** Close the card; any balance goes back to the wallet. */
cardsRouter.post('/:id/close', async (req, res) => {
  const { pin: p } = z.object({ pin }).parse(req.body);
  await verifyPin(req.user!.id, p);
  res.json(await view(await closeCard(req.user!.id, String(req.params.id))));
});

/**
 * Development only: the simulated issuer "sends" a signed purchase authorisation for this card,
 * through the same verification and decision path as a real issuer webhook.
 */
cardsRouter.post('/:id/test-purchase', async (req, res) => {
  if (env.NODE_ENV === 'production') throw new AppError('NOT_FOUND', 'Not found', 404);
  const { amount, merchantName } = z
    .object({ amount: decimalAmount, merchantName: z.string().trim().min(1).max(60).default('Test Online Store') })
    .parse(req.body);
  const card = await loadOwnCard(req.user!.id, String(req.params.id));
  if (card.issuerName !== simulatedCardIssuer.name || !card.issuerCardId) throw new AppError('NOT_SIMULATED', 'Only simulated cards can make test purchases', 409);
  const signed = simulatedCardIssuer.signedEvent({ kind: 'AUTHORIZATION', issuerCardId: card.issuerCardId, amount: await toMinor(amount), merchantName, merchantCountry: 'US' });
  const decision = await handleCardEvent(card.issuerName, simulatedCardIssuer.parseEvent(signed.body, signed.headers));
  res.json({ ...decision, authId: signed.authId });
});
