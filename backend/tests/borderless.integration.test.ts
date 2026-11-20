import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { deposit } from '../src/services/payment.service';
import { setPin } from '../src/services/pin.service';
import { getOrCreateUserWallet } from '../src/services/wallet.service';
import {
  acceptQuote,
  createQuote,
  executeTransfer,
  listCorridors,
} from '../src/modules/borderless/borderless.service';

/**
 * Borderless tests against a real PostgreSQL database (blueprint §7/§17).
 * Run against a disposable Neon branch:
 *   npx prisma migrate deploy && npx prisma db seed && npx vitest run tests/borderless.integration.test.ts
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const TZS = (major: number) => BigInt(major) * 100n;
const phone = () => `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function createUser(opts: { pin?: string; kyc?: 'APPROVED' | 'NOT_STARTED' } = {}) {
  const user = await prisma.user.create({
    data: {
      phoneNumber: phone(),
      passwordHash: 'test',
      status: 'ACTIVE',
      kycStatus: opts.kyc ?? 'APPROVED',
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
  if (opts.pin) await setPin(user.id, opts.pin);
  return { user, methodId: user.paymentMethods[0]!.id };
}

async function fundedUser(majorTzs: number, pin: string) {
  const u = await createUser({ pin });
  const txn = await deposit({ userId: u.user.id, paymentMethodId: u.methodId, amount: TZS(majorTzs), idempotencyKey: randomUUID() });
  expect(txn.status).toBe('SUCCESS');
  return u;
}

const tzsBalance = async (userId: string) => (await getOrCreateUserWallet(prisma, userId, 'TZS')).balance;
const kesBalance = async (userId: string) => (await getOrCreateUserWallet(prisma, userId, 'KES')).balance;

describe.skipIf(!hasDb)('borderless journey (database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('quotes, accepts and executes a TZS→KES send exactly once', async () => {
    const sender = await fundedUser(1_000_000, '6284');
    const recipient = await createUser();

    const corridors = await listCorridors();
    const tzKe = corridors.find((c) => c.destinationCountry === 'KE' && c.destinationCurrency === 'KES');
    expect(tzKe).toBeTruthy();

    const quote = await createQuote(sender.user.id, tzKe!.id, TZS(500_000));
    expect(quote.status).toBe('OPEN');
    expect(quote.destinationAmount).toBeGreaterThan(0n);
    expect(quote.destinationCurrency).toBe('KES');

    const accepted = await acceptQuote(sender.user.id, quote.id);
    expect(accepted.status).toBe('ACCEPTED');

    const kesBefore = await kesBalance(recipient.user.id);
    const transfer = await executeTransfer(sender.user.id, quote.id, recipient.user.phoneNumber!, '6284', randomUUID());
    expect(transfer.status).toBe('SUCCESS');

    // Recipient got exactly the quoted amount in KES.
    expect((await kesBalance(recipient.user.id)) - kesBefore).toBe(quote.destinationAmount);
    // Sender was debited principal + disclosed fee.
    expect(await tzsBalance(sender.user.id)).toBe(TZS(1_000_000) - TZS(500_000) - quote.feeAmount);
    // A settlement record exists for the corridor provider.
    const settlements = await prisma.providerSettlement.findMany({ where: { transferId: transfer.id } });
    expect(settlements).toHaveLength(1);

    // One transfer per quote: a second execute with a new key is rejected.
    await expect(
      executeTransfer(sender.user.id, quote.id, recipient.user.phoneNumber!, '6284', randomUUID()),
    ).rejects.toThrow();

    // Idempotent replay with the same key returns the original transfer.
    const replayKey = randomUUID();
    const q2 = await createQuote(sender.user.id, tzKe!.id, TZS(200_000));
    const first = await executeTransfer(sender.user.id, q2.id, recipient.user.phoneNumber!, '6284', replayKey);
    const second = await executeTransfer(sender.user.id, q2.id, recipient.user.phoneNumber!, '6284', replayKey);
    expect(second.id).toBe(first.id);
  }, 180_000);

  it('requires KYC, enforces corridor limits and rejects expired quotes', async () => {
    const noKyc = await createUser({ kyc: 'NOT_STARTED' });
    const corridors = await listCorridors();
    const tzKe = corridors.find((c) => c.destinationCountry === 'KE')!;

    await expect(createQuote(noKyc.user.id, tzKe.id, TZS(500_000))).rejects.toMatchObject({ code: 'KYC_REQUIRED' });

    const sender = await createUser();
    // Below the corridor minimum.
    await expect(createQuote(sender.user.id, tzKe.id, 100n)).rejects.toMatchObject({ code: 'AMOUNT_OUT_OF_RANGE' });

    // Expired quote cannot be accepted or executed.
    const quote = await createQuote(sender.user.id, tzKe.id, TZS(500_000));
    await prisma.fxQuote.update({ where: { id: quote.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptQuote(sender.user.id, quote.id)).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });

    // A suspended corridor is unavailable.
    await prisma.paymentCorridor.deleteMany({
      where: { originCountry: 'TZ', destinationCountry: 'UG', sourceCurrency: 'TZS', destinationCurrency: 'USD' },
    });
    const suspended = await prisma.paymentCorridor.create({
      data: {
        originCountry: 'TZ', destinationCountry: 'UG', sourceCurrency: 'TZS', destinationCurrency: 'USD',
        providerName: 'SIMULATED', minAmount: 1n, maxAmount: 1_000_000n, status: 'SUSPENDED',
      },
    });
    await expect(createQuote(sender.user.id, suspended.id, TZS(500_000))).rejects.toMatchObject({ code: 'CORRIDOR_UNAVAILABLE' });
  }, 120_000);
});
