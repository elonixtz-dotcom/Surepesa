import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { newQrToken } from '../src/lib/reference';
import { deposit, payMerchant } from '../src/services/payment.service';
import { getOrCreateBusinessWallet, getOrCreateUserWallet } from '../src/services/wallet.service';

/**
 * Merchant QR rules against a real database: dynamic codes (payment requests) fix the amount,
 * expire and can be paid once; static codes can be paid any number of times.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const TZS = (major: number) => BigInt(major) * 100n;

async function payer(majorTzs: number) {
  const user = await prisma.user.create({
    data: {
      phoneNumber: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      status: 'ACTIVE',
      kycStatus: 'APPROVED',
      paymentMethods: {
        create: { type: 'MOBILE_MONEY', provider: 'SIMULATED', accountNumber: `07${randomUUID().slice(0, 4)}6789`, maskedNumber: '07** *** 789', status: 'VERIFIED' },
      },
    },
    include: { paymentMethods: true },
  });
  if (majorTzs > 0) {
    await deposit({ userId: user.id, paymentMethodId: user.paymentMethods[0]!.id, amount: TZS(majorTzs), idempotencyKey: randomUUID() });
  }
  return user;
}

async function merchant() {
  const owner = await payer(0);
  return prisma.business.create({
    data: { ownerId: owner.id, merchantCode: `SPQ${Math.floor(Math.random() * 1e7)}`, legalName: 'QR Test Ltd', tradingName: 'QR Test Shop' },
  });
}

const qrCode = (businessId: string, data: { type: 'STATIC' | 'DYNAMIC'; amount?: bigint; expiresAt?: Date }) =>
  prisma.qrCode.create({ data: { businessId, token: newQrToken(), ...data } });

const balance = async (userId: string) => (await getOrCreateUserWallet(prisma, userId, 'TZS')).balance;
const shopBalance = async (businessId: string) => (await getOrCreateBusinessWallet(prisma, businessId, 'TZS')).balance;

describe.skipIf(!hasDb)('merchant QR codes (database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('pays a dynamic code once; a retry returns the same payment; a second payer is refused', async () => {
    const shop = await merchant();
    const a = await payer(50_000);
    const b = await payer(50_000);
    const qr = await qrCode(shop.id, { type: 'DYNAMIC', amount: TZS(12_000), expiresAt: new Date(Date.now() + 15 * 60_000) });

    const key = randomUUID();
    const paid = await payMerchant({ payerUserId: a.id, businessId: shop.id, amount: TZS(12_000), idempotencyKey: key, qrCodeId: qr.id });
    expect(paid.status).toBe('SUCCESS');
    expect((await prisma.qrCode.findUniqueOrThrow({ where: { id: qr.id } })).usedAt).not.toBeNull();

    // The customer's app retries after a dropped connection: same receipt, no second charge.
    const retry = await payMerchant({ payerUserId: a.id, businessId: shop.id, amount: TZS(12_000), idempotencyKey: key, qrCodeId: qr.id });
    expect(retry.id).toBe(paid.id);
    expect(await balance(a.id)).toBe(TZS(38_000));

    await expect(
      payMerchant({ payerUserId: b.id, businessId: shop.id, amount: TZS(12_000), idempotencyKey: randomUUID(), qrCodeId: qr.id }),
    ).rejects.toMatchObject({ code: 'QR_ALREADY_USED' });
    expect(await balance(b.id)).toBe(TZS(50_000));
    expect(await shopBalance(shop.id)).toBe(TZS(12_000));
  });

  it('refuses an expired code and a different amount', async () => {
    const shop = await merchant();
    const a = await payer(50_000);
    const expired = await qrCode(shop.id, { type: 'DYNAMIC', amount: TZS(5_000), expiresAt: new Date(Date.now() - 1000) });
    const fresh = await qrCode(shop.id, { type: 'DYNAMIC', amount: TZS(5_000), expiresAt: new Date(Date.now() + 60_000) });

    await expect(
      payMerchant({ payerUserId: a.id, businessId: shop.id, amount: TZS(5_000), idempotencyKey: randomUUID(), qrCodeId: expired.id }),
    ).rejects.toMatchObject({ code: 'QR_EXPIRED' });
    await expect(
      payMerchant({ payerUserId: a.id, businessId: shop.id, amount: TZS(4_000), idempotencyKey: randomUUID(), qrCodeId: fresh.id }),
    ).rejects.toMatchObject({ code: 'QR_AMOUNT_MISMATCH' });
    expect(await balance(a.id)).toBe(TZS(50_000));
  });

  it("refuses another merchant's code", async () => {
    const shop = await merchant();
    const other = await merchant();
    const a = await payer(20_000);
    const qr = await qrCode(other.id, { type: 'STATIC' });
    await expect(
      payMerchant({ payerUserId: a.id, businessId: shop.id, amount: TZS(1_000), idempotencyKey: randomUUID(), qrCodeId: qr.id }),
    ).rejects.toMatchObject({ code: 'QR_INVALID' });
  });

  it('lets exactly one of two racing payers use a dynamic code', async () => {
    const shop = await merchant();
    const a = await payer(30_000);
    const b = await payer(30_000);
    const qr = await qrCode(shop.id, { type: 'DYNAMIC', amount: TZS(10_000), expiresAt: new Date(Date.now() + 60_000) });

    const results = await Promise.allSettled(
      [a, b].map((p) => payMerchant({ payerUserId: p.id, businessId: shop.id, amount: TZS(10_000), idempotencyKey: randomUUID(), qrCodeId: qr.id })),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.status === 'SUCCESS');
    expect(succeeded).toHaveLength(1);
    expect(await shopBalance(shop.id)).toBe(TZS(10_000));
    expect((await balance(a.id)) + (await balance(b.id))).toBe(TZS(50_000));
  });

  it('leaves the code unused when the payment itself fails', async () => {
    const shop = await merchant();
    const poor = await payer(1_000);
    const qr = await qrCode(shop.id, { type: 'DYNAMIC', amount: TZS(9_000), expiresAt: new Date(Date.now() + 60_000) });

    const failed = await payMerchant({ payerUserId: poor.id, businessId: shop.id, amount: TZS(9_000), idempotencyKey: randomUUID(), qrCodeId: qr.id });
    expect(failed.status).toBe('FAILED');
    expect(failed.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect((await prisma.qrCode.findUniqueOrThrow({ where: { id: qr.id } })).usedAt).toBeNull();

    const rich = await payer(20_000);
    const paid = await payMerchant({ payerUserId: rich.id, businessId: shop.id, amount: TZS(9_000), idempotencyKey: randomUUID(), qrCodeId: qr.id });
    expect(paid.status).toBe('SUCCESS');
  });

  it('accepts a static code any number of times, at any amount', async () => {
    const shop = await merchant();
    const a = await payer(30_000);
    const qr = await qrCode(shop.id, { type: 'STATIC' });
    for (const amount of [1_000, 2_500, 1_000]) {
      const t = await payMerchant({ payerUserId: a.id, businessId: shop.id, amount: TZS(amount), idempotencyKey: randomUUID(), qrCodeId: qr.id });
      expect(t.status).toBe('SUCCESS');
    }
    expect(await shopBalance(shop.id)).toBe(TZS(4_500));
  });
});
