import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { prisma } from '../src/lib/prisma';
import { simulatedProvider } from '../src/providers';
import { createApp } from '../src/app';
import { deposit, payMerchant, RAIL_MAX_CHECKS, refundPayment, reverseTransaction, sendMoney, withdraw } from '../src/services/payment.service';
import { checkRailNow, handleProviderCallback, syncRails } from '../src/services/rail-sync.service';
import { invalidateFeeCache } from '../src/services/fee.service';
import { reconcileLedger } from '../src/services/ledger.service';
import { getOrCreateUserWallet } from '../src/services/wallet.service';

/**
 * Real-rail safety scenarios against a real PostgreSQL database: pending, ambiguous and
 * timed-out rails, duplicate and forged callbacks, escalation, partial refunds, fee rules.
 * Point DATABASE_URL at a Neon *branch* used only for tests (see payments.integration.test.ts).
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const TZS = (major: number) => BigInt(major) * 100n;

/** Simulator behaviour is chosen by the account's last four digits (see simulated.provider.ts). */
async function userWithAccount(suffix = '') {
  const accountNumber = `07${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}${suffix || '7' + randomUUID().replace(/\D/g, '').slice(0, 3)}`;
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      passwordHash: 'test',
      status: 'ACTIVE',
      kycStatus: 'APPROVED',
      profile: { create: { firstName: 'Test', lastName: 'Customer' } },
      paymentMethods: {
        create: { type: 'MOBILE_MONEY', provider: 'SIMULATED', accountNumber, maskedNumber: '07** *** ***', status: 'VERIFIED' },
      },
    },
    include: { paymentMethods: true },
  });
  return { user, methodId: user.paymentMethods[0]!.id };
}

async function funded(majorTzs: number, suffix = '') {
  const u = await userWithAccount(suffix);
  // Fund through a separate, instantly-settling account so the scenario account stays clean.
  const instant = await prisma.paymentMethod.create({
    data: { userId: u.user.id, type: 'MOBILE_MONEY', provider: 'SIMULATED', accountNumber: `07${randomUUID().slice(0, 4)}6789`, maskedNumber: '07** *** 789', status: 'VERIFIED' },
  });
  const txn = await deposit({ userId: u.user.id, paymentMethodId: instant.id, amount: TZS(majorTzs), idempotencyKey: randomUUID() });
  expect(txn.status).toBe('SUCCESS');
  return u;
}

const balanceOf = async (userId: string) => (await getOrCreateUserWallet(prisma, userId, 'TZS')).balance;
const reload = (id: string) => prisma.transaction.findUniqueOrThrow({ where: { id } });
const callback = (reference: string, status: 'SUCCESS' | 'FAILED' | 'PENDING', eventId = `evt_${randomUUID()}`) =>
  simulatedProvider.parseCallback(...(Object.values(simulatedProvider.signedCallback({ reference, status, eventId })) as [Buffer, Record<string, string>]));

describe.skipIf(!hasDb)('real-rail safety (database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('credits a pending deposit only when the rail confirms, exactly once', async () => {
    const a = await userWithAccount('1111');
    const txn = await deposit({ userId: a.user.id, paymentMethodId: a.methodId, amount: TZS(25_000), idempotencyKey: randomUUID() });

    expect(txn.status).toBe('PROCESSING');
    expect(txn.railStatus).toBe('PENDING');
    expect(txn.nextRailCheckAt).not.toBeNull();
    expect(await balanceOf(a.user.id)).toBe(0n);

    const cb = callback(txn.reference, 'SUCCESS', `evt_${randomUUID()}`);
    expect(await handleProviderCallback('SIMULATED', cb)).toBe('APPLIED');
    expect(await balanceOf(a.user.id)).toBe(TZS(25_000));

    // The rail delivers the same event again, and then a different event for the same payment.
    expect(await handleProviderCallback('SIMULATED', cb)).toBe('DUPLICATE');
    expect(await handleProviderCallback('SIMULATED', callback(txn.reference, 'SUCCESS'))).toBe('ALREADY_FINAL');
    expect(await balanceOf(a.user.id)).toBe(TZS(25_000));
    expect((await reload(txn.id)).status).toBe('SUCCESS');
  });

  it('credits once when a callback and a status poll race', async () => {
    const a = await userWithAccount('1111');
    const txn = await deposit({ userId: a.user.id, paymentMethodId: a.methodId, amount: TZS(10_000), idempotencyKey: randomUUID() });
    const withMethod = await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id }, include: { paymentMethod: true } });

    const outcomes = await Promise.all([
      handleProviderCallback('SIMULATED', callback(txn.reference, 'SUCCESS')),
      checkRailNow(withMethod),
      checkRailNow(withMethod),
    ]);
    expect(outcomes.filter((o) => o === 'APPLIED')).toHaveLength(1);
    expect(await balanceOf(a.user.id)).toBe(TZS(10_000));
    expect(await prisma.ledgerEntry.count({ where: { transactionId: txn.id, entryType: 'PRINCIPAL' } })).toBe(2);
  });

  it('keeps funds held when a payout times out, then settles from the rail', async () => {
    const a = await funded(50_000, '3333');
    const txn = await withdraw({ userId: a.user.id, paymentMethodId: a.methodId, amount: TZS(20_000), idempotencyKey: randomUUID() });

    // The call threw, but the payout may have gone out: never refund on a timeout.
    expect(txn.status).toBe('PROCESSING');
    expect(txn.railStatus).toBe('AMBIGUOUS');
    const held = await balanceOf(a.user.id);
    expect(held).toBe(TZS(50_000) - TZS(20_000) - txn.fee);

    await prisma.transaction.update({ where: { id: txn.id }, data: { nextRailCheckAt: new Date(Date.now() - 1000) } });
    const summary = await syncRails();
    expect(summary.checked).toBeGreaterThanOrEqual(1);
    expect((await reload(txn.id)).status).toBe('SUCCESS');
    expect(await balanceOf(a.user.id)).toBe(held);
  });

  it('returns the money when the rail later rejects a payout', async () => {
    const a = await funded(50_000, '4444');
    const txn = await withdraw({ userId: a.user.id, paymentMethodId: a.methodId, amount: TZS(20_000), idempotencyKey: randomUUID() });
    expect(txn.status).toBe('PROCESSING');
    expect(await balanceOf(a.user.id)).toBeLessThan(TZS(50_000));

    const withMethod = await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id }, include: { paymentMethod: true } });
    expect(await checkRailNow(withMethod)).toBe('APPLIED');

    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id }, include: { reversedBy: true } });
    expect(after.status).toBe('FAILED');
    expect(after.reversedBy?.status).toBe('SUCCESS');
    expect(await balanceOf(a.user.id)).toBe(TZS(50_000));
  });

  it('escalates to Finance when the rail never answers, without guessing', async () => {
    const a = await funded(50_000, '5555');
    const txn = await withdraw({ userId: a.user.id, paymentMethodId: a.methodId, amount: TZS(10_000), idempotencyKey: randomUUID() });
    const withMethod = await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id }, include: { paymentMethod: true } });

    let outcome = '';
    for (let i = 0; i < RAIL_MAX_CHECKS; i++) outcome = await checkRailNow(withMethod);
    expect(outcome).toBe('ESCALATED');

    const after = await reload(txn.id);
    expect(after.status).toBe('PROCESSING'); // funds stay held
    expect(after.escalatedAt).not.toBeNull();
    expect(after.nextRailCheckAt).toBeNull(); // the poller stops; a person takes over
    expect(after.railCheckCount).toBe(RAIL_MAX_CHECKS);
  });

  it("never lets one provider's callback settle another provider's transaction", async () => {
    const a = await userWithAccount('1111');
    const txn = await deposit({ userId: a.user.id, paymentMethodId: a.methodId, amount: TZS(5_000), idempotencyKey: randomUUID() });
    expect(await handleProviderCallback('MPESA_TZ', callback(txn.reference, 'SUCCESS'))).toBe('UNKNOWN_TRANSACTION');
    expect((await reload(txn.id)).status).toBe('PROCESSING');
    expect(await balanceOf(a.user.id)).toBe(0n);
  });

  it('serves the webhook over HTTP: verified callbacks settle, forged ones get 401', async () => {
    const a = await userWithAccount('1111');
    const txn = await deposit({ userId: a.user.id, paymentMethodId: a.methodId, amount: TZS(7_500), idempotencyKey: randomUUID() });

    const server = createApp().listen(0);
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/providers/simulated/callbacks`;
      const forged = simulatedProvider.signedCallback({ reference: txn.reference, status: 'SUCCESS' });
      const tampered = await fetch(url, { method: 'POST', headers: forged.headers, body: forged.body.toString().replace(txn.reference, `${txn.reference} `) });
      expect(tampered.status).toBe(401);
      expect(await balanceOf(a.user.id)).toBe(0n);

      const real = simulatedProvider.signedCallback({ reference: txn.reference, status: 'SUCCESS' });
      const ok = await fetch(url, { method: 'POST', headers: real.headers, body: real.body });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ received: true, outcome: 'APPLIED' });
      expect(await balanceOf(a.user.id)).toBe(TZS(7_500));
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('refunds a merchant payment in parts, never beyond what was paid', async () => {
    const payer = await funded(100_000);
    const owner = await userWithAccount();
    const business = await prisma.business.create({
      data: { ownerId: owner.user.id, merchantCode: `SPM${Math.floor(Math.random() * 1e6)}`, legalName: 'Test Duka Ltd', tradingName: 'Test Duka' },
    });
    const payment = await payMerchant({ payerUserId: payer.user.id, businessId: business.id, amount: TZS(40_000), idempotencyKey: randomUUID() });
    expect(payment.status).toBe('SUCCESS');
    const admin = { type: 'SYSTEM' as const };

    const first = await refundPayment({ transactionId: payment.id, amount: TZS(15_000), reason: 'One item returned', actor: admin });
    expect(first.status).toBe('SUCCESS');
    expect(first.refundsTransactionId).toBe(payment.id);

    await expect(refundPayment({ transactionId: payment.id, amount: TZS(25_001), reason: 'Too much', actor: admin })).rejects.toMatchObject({
      code: 'REFUND_EXCEEDS_PAYMENT',
    });
    await expect(reverseTransaction(payment.id, { actor: admin, reason: 'Full reversal' })).rejects.toMatchObject({ code: 'PARTIALLY_REFUNDED' });

    await refundPayment({ transactionId: payment.id, amount: TZS(25_000), reason: 'Rest returned', actor: admin });
    expect(await balanceOf(payer.user.id)).toBe(TZS(100_000));
    await expect(refundPayment({ transactionId: payment.id, amount: TZS(1), reason: 'Nothing left', actor: admin })).rejects.toMatchObject({
      code: 'REFUND_EXCEEDS_PAYMENT',
    });
  });

  it('charges fees from the fee_rules table', async () => {
    const rule = await prisma.feeRule.create({
      data: { transactionType: 'P2P_TRANSFER', bps: 100, minFee: 0n, maxFee: TZS(1_000), note: 'test: 1% capped at TZS 1,000' },
    });
    invalidateFeeCache();
    try {
      const a = await funded(200_000);
      const b = await userWithAccount();
      const small = await sendMoney({ senderUserId: a.user.id, recipientUserId: b.user.id, amount: TZS(10_000), idempotencyKey: randomUUID() });
      const large = await sendMoney({ senderUserId: a.user.id, recipientUserId: b.user.id, amount: TZS(150_000), idempotencyKey: randomUUID() });
      expect(small.fee).toBe(TZS(100));
      expect(large.fee).toBe(TZS(1_000)); // capped
    } finally {
      await prisma.feeRule.delete({ where: { id: rule.id } });
      invalidateFeeCache();
    }
  });

  it('keeps the whole ledger reconciled', async () => {
    const report = await reconcileLedger(prisma);
    expect(report.ok).toBe(true);
  });
});
