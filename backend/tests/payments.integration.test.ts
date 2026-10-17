import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { deposit, reverseTransaction, sendMoney, withdraw } from '../src/services/payment.service';
import { reconcileLedger } from '../src/services/ledger.service';
import { getOrCreateUserWallet } from '../src/services/wallet.service';

/**
 * Financial-integrity scenarios (roadmap Phase 15) against a real PostgreSQL database.
 * Point DATABASE_URL at a Neon *branch* used only for tests, then run:
 *   npx prisma migrate deploy && npx prisma db seed && npm test
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const TZS = (major: number) => BigInt(major) * 100n;

async function createVerifiedUser() {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      passwordHash: 'test',
      status: 'ACTIVE',
      kycStatus: 'APPROVED',
      paymentMethods: {
        create: {
          type: 'MOBILE_MONEY',
          provider: 'SIMULATED',
          accountNumber: `07${randomUUID().slice(0, 8)}`,
          maskedNumber: '07** *** ***',
          status: 'VERIFIED',
        },
      },
    },
    include: { paymentMethods: true },
  });
  return { user, methodId: user.paymentMethods[0]!.id };
}

async function fundedUser(majorTzs: number) {
  const u = await createVerifiedUser();
  if (majorTzs > 0) {
    const txn = await deposit({ userId: u.user.id, paymentMethodId: u.methodId, amount: TZS(majorTzs), idempotencyKey: randomUUID() });
    expect(txn.status).toBe('SUCCESS');
  }
  return u;
}

const balanceOf = async (userId: string) => (await getOrCreateUserWallet(prisma, userId, 'TZS')).balance;

describe.skipIf(!hasDb)('payment engine (database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('moves money between users: A 100,000 → B 50,000, A sends 20,000', async () => {
    const a = await fundedUser(100_000);
    const b = await fundedUser(50_000);

    const txn = await sendMoney({ senderUserId: a.user.id, recipientUserId: b.user.id, amount: TZS(20_000), idempotencyKey: randomUUID() });

    expect(txn.status).toBe('SUCCESS');
    expect(txn.reference).toMatch(/^SPX-[0-9A-Z]{10}$/);
    expect(await balanceOf(a.user.id)).toBe(TZS(80_000));
    expect(await balanceOf(b.user.id)).toBe(TZS(70_000));

    const events = await prisma.transactionEvent.findMany({ where: { transactionId: txn.id }, orderBy: { id: 'asc' } });
    expect(events.map((e) => e.toStatus)).toEqual(['PROCESSING', 'SUCCESS']);
  });

  it('fails on insufficient funds without moving money', async () => {
    const a = await fundedUser(10_000);
    const b = await fundedUser(0);

    const txn = await sendMoney({ senderUserId: a.user.id, recipientUserId: b.user.id, amount: TZS(20_000), idempotencyKey: randomUUID() });

    expect(txn.status).toBe('FAILED');
    expect(txn.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(await balanceOf(a.user.id)).toBe(TZS(10_000));
    expect(await balanceOf(b.user.id)).toBe(0n);
    expect(await prisma.ledgerEntry.count({ where: { transactionId: txn.id } })).toBe(0);
  });

  it('processes a duplicated request only once', async () => {
    const a = await fundedUser(100_000);
    const b = await fundedUser(0);
    const req = { senderUserId: a.user.id, recipientUserId: b.user.id, amount: TZS(5_000), idempotencyKey: randomUUID() };

    // Sequential retry, then a concurrent burst with the same key.
    const first = await sendMoney(req);
    const burst = await Promise.all([sendMoney(req), sendMoney(req), sendMoney(req)]);

    expect(new Set([first, ...burst].map((t) => t.id)).size).toBe(1);
    expect(await balanceOf(a.user.id)).toBe(TZS(95_000));
    expect(await balanceOf(b.user.id)).toBe(TZS(5_000));
  });

  it('rejects reusing an idempotency key for a different payment', async () => {
    const a = await fundedUser(100_000);
    const b = await fundedUser(0);
    const key = randomUUID();
    await sendMoney({ senderUserId: a.user.id, recipientUserId: b.user.id, amount: TZS(1_000), idempotencyKey: key });
    await expect(
      sendMoney({ senderUserId: a.user.id, recipientUserId: b.user.id, amount: TZS(2_000), idempotencyKey: key }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('never lets concurrent payments overspend a balance', async () => {
    const a = await fundedUser(100_000);
    const b = await fundedUser(0);

    // Five simultaneous 30,000 payments from 100,000: exactly three can succeed.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        sendMoney({ senderUserId: a.user.id, recipientUserId: b.user.id, amount: TZS(30_000), idempotencyKey: randomUUID() }),
      ),
    );

    expect(results.filter((t) => t.status === 'SUCCESS')).toHaveLength(3);
    expect(results.filter((t) => t.status === 'FAILED')).toHaveLength(2);
    expect(await balanceOf(a.user.id)).toBe(TZS(10_000));
    expect(await balanceOf(b.user.id)).toBe(TZS(90_000));
  });

  it('reverses a successful payment and returns the money', async () => {
    const a = await fundedUser(100_000);
    const b = await fundedUser(0);
    const txn = await sendMoney({ senderUserId: a.user.id, recipientUserId: b.user.id, amount: TZS(25_000), idempotencyKey: randomUUID() });

    const admin = await prisma.adminUser.create({
      data: { email: `${randomUUID()}@surepesa.test`, fullName: 'Finance Admin', passwordHash: 'x', role: 'FINANCE' },
    });
    const reversal = await reverseTransaction(txn.id, { actor: { type: 'ADMIN', id: admin.id }, reason: 'Sent to wrong number' });

    expect(reversal.status).toBe('SUCCESS');
    expect(reversal.reversesTransactionId).toBe(txn.id);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe('REVERSED');
    expect(await balanceOf(a.user.id)).toBe(TZS(100_000));
    expect(await balanceOf(b.user.id)).toBe(0n);
    expect(await prisma.auditLog.count({ where: { entityId: txn.id, action: 'TRANSACTION_REVERSED' } })).toBe(1);

    await expect(reverseTransaction(txn.id, { actor: { type: 'ADMIN', id: admin.id }, reason: 'again' })).rejects.toMatchObject({
      code: 'ALREADY_REVERSED',
    });
  });

  it('refuses a reversal when the recipient already spent the money', async () => {
    const a = await fundedUser(100_000);
    const b = await fundedUser(0);
    const c = await fundedUser(0);
    const txn = await sendMoney({ senderUserId: a.user.id, recipientUserId: b.user.id, amount: TZS(25_000), idempotencyKey: randomUUID() });
    await sendMoney({ senderUserId: b.user.id, recipientUserId: c.user.id, amount: TZS(20_000), idempotencyKey: randomUUID() });

    await expect(reverseTransaction(txn.id, { actor: { type: 'SYSTEM' }, reason: 'test' })).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe('SUCCESS');
    expect(await balanceOf(b.user.id)).toBe(TZS(5_000));
  });

  it('charges withdrawal fees and refunds a failed payout', async () => {
    const a = await fundedUser(100_000);

    const ok = await withdraw({ userId: a.user.id, paymentMethodId: a.methodId, amount: TZS(10_000), idempotencyKey: randomUUID() });
    expect(ok.status).toBe('SUCCESS');
    expect(ok.fee).toBe(TZS(500));
    expect(await balanceOf(a.user.id)).toBe(TZS(89_500));

    // The simulator declines accounts ending in 0000.
    const declining = await prisma.paymentMethod.create({
      data: { userId: a.user.id, type: 'MOBILE_MONEY', provider: 'SIMULATED', accountNumber: '0712340000', maskedNumber: '07** *** 000', status: 'VERIFIED' },
    });
    const failed = await withdraw({ userId: a.user.id, paymentMethodId: declining.id, amount: TZS(10_000), idempotencyKey: randomUUID() });
    expect(failed.status).toBe('FAILED');
    expect(failed.failureCode).toBe('SIMULATED_DECLINE');
    expect(await balanceOf(a.user.id)).toBe(TZS(89_500));
  });

  it('blocks unverified users from sending', async () => {
    const a = await fundedUser(10_000);
    const b = await fundedUser(0);
    await prisma.user.update({ where: { id: a.user.id }, data: { kycStatus: 'PENDING' } });
    await expect(
      sendMoney({ senderUserId: a.user.id, recipientUserId: b.user.id, amount: TZS(1_000), idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'KYC_REQUIRED' });
  });

  it('keeps the whole ledger reconciled', async () => {
    const report = await reconcileLedger(prisma);
    expect(report).toMatchObject({ ok: true, walletMismatches: [], currencyImbalances: [], unbalancedTransactions: [] });
  });
});
