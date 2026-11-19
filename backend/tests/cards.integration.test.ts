import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { prisma } from '../src/lib/prisma';
import { createApp } from '../src/app';
import { simulatedCardIssuer } from '../src/providers';
import { CardEventKind } from '../src/providers/card-issuer';
import { luhnValid } from '../src/providers/simulated-card-issuer';
import {
  closeCard,
  createCard,
  freezeCard,
  handleCardEvent,
  loadCard,
  MAX_OPEN_CARDS,
  REVEALS_PER_HOUR,
  revealCard,
  setCardLimit,
  unloadCard,
} from '../src/services/card.service';
import { deposit } from '../src/services/payment.service';
import { reconcileLedger } from '../src/services/ledger.service';
import { getOrCreateUserWallet } from '../src/services/wallet.service';

/** Virtual cards against a real database: issue, fund, spend, reverse, refund, reveal, close. */
const hasDb = Boolean(process.env.DATABASE_URL);
const TZS = (major: number) => BigInt(major) * 100n;

async function customer(fundsTzs: number, kycStatus: 'APPROVED' | 'PENDING' = 'APPROVED') {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      status: 'ACTIVE',
      kycStatus,
      profile: { create: { firstName: 'Card', lastName: 'Holder' } },
      paymentMethods: {
        create: { type: 'MOBILE_MONEY', provider: 'SIMULATED', accountNumber: `07${randomUUID().slice(0, 4)}6789`, maskedNumber: '07** *** 789', status: 'VERIFIED' },
      },
    },
    include: { paymentMethods: true },
  });
  if (fundsTzs) await deposit({ userId: user.id, paymentMethodId: user.paymentMethods[0]!.id, amount: TZS(fundsTzs), idempotencyKey: randomUUID() });
  return user;
}

const walletBalance = async (userId: string) => (await getOrCreateUserWallet(prisma, userId, 'TZS')).balance;
const cardBalance = async (cardId: string) => (await prisma.wallet.findUniqueOrThrow({ where: { cardId } })).balance;

function event(issuerCardId: string, kind: CardEventKind, amountTzs: number, extra: { authId?: string; eventId?: string; merchantName?: string } = {}) {
  const signed = simulatedCardIssuer.signedEvent({ kind, issuerCardId, amount: TZS(amountTzs), merchantName: 'Netflix', merchantCountry: 'US', ...extra });
  return { ev: simulatedCardIssuer.parseEvent(signed.body, signed.headers), authId: signed.authId, signed };
}

describe.skipIf(!hasDb)('virtual cards (database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('issues a card without ever storing its number or CVV', async () => {
    const u = await customer(0);
    const card = await createCard({ userId: u.id, nickname: 'Online shopping' });
    expect(card.status).toBe('ACTIVE');
    expect(card.last4).toMatch(/^\d{4}$/);
    expect(card.expiryYear).toBeGreaterThan(new Date().getFullYear());
    expect(await cardBalance(card.id)).toBe(0n);

    const details = await revealCard(u.id, card.id);
    if (details.kind !== 'DETAILS') throw new Error('expected details');
    expect(details.pan).toHaveLength(16);
    expect(luhnValid(details.pan)).toBe(true);
    expect(details.pan.endsWith(card.last4!)).toBe(true);
    expect(details.cvv).toMatch(/^\d{3}$/);

    // The full number and CVV must not appear in any row we keep about this card.
    const rows = JSON.stringify(
      await Promise.all([
        prisma.virtualCard.findUnique({ where: { id: card.id } }),
        prisma.auditLog.findMany({ where: { entityId: card.id } }),
        prisma.wallet.findUnique({ where: { cardId: card.id } }),
      ]),
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    );
    expect(rows).not.toContain(details.pan);
    expect(rows).not.toContain(`"${details.cvv}"`);
  });

  it('loads and unloads a card through the ledger', async () => {
    const u = await customer(100_000);
    const card = await createCard({ userId: u.id, nickname: 'Travel' });
    const load = await loadCard(u.id, card.id, TZS(60_000), randomUUID());
    expect(load.status).toBe('SUCCESS');
    expect(await cardBalance(card.id)).toBe(TZS(60_000));
    expect(await walletBalance(u.id)).toBe(TZS(40_000));

    const back = await unloadCard(u.id, card.id, TZS(15_000), randomUUID());
    expect(back.status).toBe('SUCCESS');
    expect(await cardBalance(card.id)).toBe(TZS(45_000));
    expect(await walletBalance(u.id)).toBe(TZS(55_000));

    const tooMuch = await loadCard(u.id, card.id, TZS(1_000_000), randomUUID());
    expect(tooMuch.status).toBe('FAILED');
    expect(tooMuch.failureCode).toBe('INSUFFICIENT_FUNDS');
  }, 150_000); // several round trips to Neon

  it('approves a purchase once, even when the issuer redelivers it', async () => {
    const u = await customer(100_000);
    const card = await createCard({ userId: u.id, nickname: 'Netflix' });
    await loadCard(u.id, card.id, TZS(50_000), randomUUID());

    const { ev, authId } = event(card.issuerCardId!, 'AUTHORIZATION', 12_000);
    expect(await handleCardEvent('SIMULATED', ev)).toMatchObject({ decision: 'APPROVED' });
    // Same event again, and the same authorisation under a new event id.
    expect(await handleCardEvent('SIMULATED', ev)).toMatchObject({ decision: 'APPROVED' });
    expect(await handleCardEvent('SIMULATED', event(card.issuerCardId!, 'AUTHORIZATION', 12_000, { authId }).ev)).toMatchObject({ decision: 'APPROVED' });
    expect(await cardBalance(card.id)).toBe(TZS(38_000));
  });

  it('declines for low balance, the card limit and a frozen card, moving no money', async () => {
    const u = await customer(100_000);
    const card = await createCard({ userId: u.id, nickname: 'Shopping' });
    await loadCard(u.id, card.id, TZS(20_000), randomUUID());

    expect(await handleCardEvent('SIMULATED', event(card.issuerCardId!, 'AUTHORIZATION', 25_000).ev)).toMatchObject({ decision: 'DECLINED', reason: 'INSUFFICIENT_FUNDS' });

    await setCardLimit(u.id, card.id, TZS(10_000));
    expect(await handleCardEvent('SIMULATED', event(card.issuerCardId!, 'AUTHORIZATION', 15_000).ev)).toMatchObject({ decision: 'DECLINED', reason: 'OVER_CARD_LIMIT' });

    await freezeCard(u.id, card.id, true);
    expect(await handleCardEvent('SIMULATED', event(card.issuerCardId!, 'AUTHORIZATION', 5_000).ev)).toMatchObject({ decision: 'DECLINED', reason: 'CARD_FROZEN' });
    await freezeCard(u.id, card.id, false);
    expect(await handleCardEvent('SIMULATED', event(card.issuerCardId!, 'AUTHORIZATION', 5_000).ev)).toMatchObject({ decision: 'APPROVED' });

    expect(await cardBalance(card.id)).toBe(TZS(15_000));
  });

  it('gives money back on a reversal, and caps refunds at the purchase', async () => {
    const u = await customer(100_000);
    const card = await createCard({ userId: u.id, nickname: 'Shopping' });
    await loadCard(u.id, card.id, TZS(50_000), randomUUID());

    const first = event(card.issuerCardId!, 'AUTHORIZATION', 20_000);
    await handleCardEvent('SIMULATED', first.ev);
    expect(await handleCardEvent('SIMULATED', event(card.issuerCardId!, 'REVERSAL', 20_000, { authId: first.authId }).ev)).toMatchObject({ decision: 'APPROVED' });
    expect(await cardBalance(card.id)).toBe(TZS(50_000));

    const second = event(card.issuerCardId!, 'AUTHORIZATION', 10_000);
    await handleCardEvent('SIMULATED', second.ev);
    expect(await handleCardEvent('SIMULATED', event(card.issuerCardId!, 'REFUND', 4_000, { authId: second.authId }).ev)).toMatchObject({ decision: 'APPROVED' });
    expect(await handleCardEvent('SIMULATED', event(card.issuerCardId!, 'REFUND', 7_000, { authId: second.authId }).ev)).toMatchObject({
      decision: 'DECLINED',
      reason: 'REFUND_EXCEEDS_PURCHASE',
    });
    expect(await cardBalance(card.id)).toBe(TZS(44_000));
    expect(await handleCardEvent('SIMULATED', event(card.issuerCardId!, 'REVERSAL', 1_000, { authId: 'AUTH-unknown' }).ev)).toMatchObject({
      decision: 'DECLINED',
      reason: 'UNKNOWN_AUTHORIZATION',
    });
  });

  it('limits how often card details can be revealed', async () => {
    const u = await customer(0);
    const card = await createCard({ userId: u.id, nickname: 'Reveal test' });
    for (let i = 0; i < REVEALS_PER_HOUR; i++) await revealCard(u.id, card.id);
    await expect(revealCard(u.id, card.id)).rejects.toMatchObject({ code: 'TOO_MANY_REVEALS' });
  });

  it('closes a card: the balance returns to the wallet and later purchases are declined', async () => {
    const u = await customer(80_000);
    const card = await createCard({ userId: u.id, nickname: 'Temporary' });
    await loadCard(u.id, card.id, TZS(30_000), randomUUID());
    await handleCardEvent('SIMULATED', event(card.issuerCardId!, 'AUTHORIZATION', 7_500).ev);

    const closed = await closeCard(u.id, card.id);
    expect(closed.status).toBe('CLOSED');
    expect(await cardBalance(card.id)).toBe(0n);
    expect(await walletBalance(u.id)).toBe(TZS(80_000) - TZS(7_500));
    expect(await handleCardEvent('SIMULATED', event(card.issuerCardId!, 'AUTHORIZATION', 1_000).ev)).toMatchObject({ decision: 'DECLINED', reason: 'CARD_NOT_ACTIVE' });
    await expect(loadCard(u.id, card.id, TZS(1_000), randomUUID())).rejects.toMatchObject({ code: 'CARD_NOT_ACTIVE' });
  });

  it(`allows ${MAX_OPEN_CARDS} open cards per customer and requires verified identity`, async () => {
    const u = await customer(0);
    for (let i = 0; i < MAX_OPEN_CARDS; i++) await createCard({ userId: u.id, nickname: `Card ${i + 1}` });
    await expect(createCard({ userId: u.id, nickname: 'One too many' })).rejects.toMatchObject({ code: 'TOO_MANY_CARDS' });

    const unverified = await customer(0, 'PENDING');
    await expect(createCard({ userId: unverified.id, nickname: 'Nope' })).rejects.toMatchObject({ code: 'KYC_REQUIRED' });
  });

  it('refuses forged issuer events over HTTP and answers real ones with a decision', async () => {
    const u = await customer(50_000);
    const card = await createCard({ userId: u.id, nickname: 'Webhook' });
    await loadCard(u.id, card.id, TZS(10_000), randomUUID());

    const server = createApp().listen(0);
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/providers/simulated/card-events`;
      const { signed } = event(card.issuerCardId!, 'AUTHORIZATION', 3_000);
      const forged = await fetch(url, { method: 'POST', headers: signed.headers, body: signed.body.toString().replace('"300000"', '"100"') });
      expect(forged.status).toBe(401);
      const ok = await fetch(url, { method: 'POST', headers: signed.headers, body: signed.body });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ decision: 'APPROVED' });
      expect(await cardBalance(card.id)).toBe(TZS(7_000));
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('keeps the whole ledger reconciled', async () => {
    expect((await reconcileLedger(prisma)).ok).toBe(true);
  });
});
