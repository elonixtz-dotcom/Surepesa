import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { deposit, sendMoney } from '../src/services/payment.service';
import { setPin } from '../src/services/pin.service';
import { getOrCreateUserWallet, getSystemWallet, systemWalletCode } from '../src/services/wallet.service';
import {
  acceptTerms,
  agreeRefund,
  confirmReceipt,
  createEscrowCase,
  fundCase,
  getEscrowWalletSummary,
  markDelivered,
  markFulfilment,
  openDispute,
  resolveDispute,
} from '../src/modules/escrow/escrow.service';

/**
 * Escrow ★ full-journey tests against a real PostgreSQL database (blueprint §10/§17).
 * Run against a disposable Neon branch:
 *   npx prisma migrate deploy && npx prisma db seed && npx vitest run tests/escrow.integration.test.ts
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const TZS = (major: number) => BigInt(major) * 100n;
const phone = () => `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function createUser(pin?: string) {
  const user = await prisma.user.create({
    data: {
      phoneNumber: phone(),
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
  if (pin) await setPin(user.id, pin);
  return { user, methodId: user.paymentMethods[0]!.id };
}

async function fundedBuyer(majorTzs: number, pin: string) {
  const u = await createUser(pin);
  const txn = await deposit({ userId: u.user.id, paymentMethodId: u.methodId, amount: TZS(majorTzs), idempotencyKey: randomUUID() });
  expect(txn.status).toBe('SUCCESS');
  return u;
}

const balanceOf = async (userId: string) => (await getOrCreateUserWallet(prisma, userId, 'TZS')).balance;

async function makeDeal(amountMajor: number, buyerPin = '5283') {
  const buyer = await fundedBuyer(amountMajor * 2, buyerPin);
  const seller = await createUser();
  const c = await createEscrowCase({
    buyerId: buyer.user.id,
    sellerPhone: seller.user.phoneNumber!,
    itemDescription: 'Used iPhone 13, good condition',
    amount: TZS(amountMajor),
    idempotencyKey: randomUUID(),
  });
  return { buyer, seller, escrowCase: c };
}

async function adminUser() {
  return prisma.adminUser.create({
    data: {
      email: `admin-${randomUUID().slice(0, 8)}@surepesa.co.tz`,
      fullName: 'Test Admin',
      passwordHash: 'test',
      role: 'FINANCE',
    },
  });
}

describe.skipIf(!hasDb)('escrow journey (database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('completes create → accept → fund → deliver → confirm → release, exactly once', async () => {
    const { buyer, seller, escrowCase } = await makeDeal(100_000);

    const accepted = await acceptTerms(seller.user.id, escrowCase.id);
    expect(accepted.status).toBe('AWAITING_FUNDING');

    const sellerBefore = await balanceOf(seller.user.id);
    const funded = await fundCase(buyer.user.id, escrowCase.id, '5283', randomUUID());
    expect(funded.status).toBe('FUNDED');
    expect(funded.escrowWalletId).toBeTruthy();

    // The held funds are visible read-only, and the buyer's wallet was debited.
    const summary = await getEscrowWalletSummary(buyer.user.id, escrowCase.id);
    expect(summary.heldMinor).toBe(TZS(100_000).toString());
    expect(await balanceOf(buyer.user.id)).toBe(TZS(100_000)); // 200k deposited - 100k held

    // Held funds cannot be spent through the normal wallet path: the buyer only has
    // 100k left, so a 150k P2P fails, and the escrow wallet has no userId at all.
    const escrowWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: funded.escrowWalletId! } });
    expect(escrowWallet.kind).toBe('ESCROW_HOLDING');
    expect(escrowWallet.userId).toBeNull();
    const stranger = await createUser();
    const failed = await sendMoney({
      senderUserId: buyer.user.id,
      recipientUserId: stranger.user.id,
      amount: TZS(150_000),
      idempotencyKey: randomUUID(),
    });
    expect(failed.status).toBe('FAILED');

    await markFulfilment(seller.user.id, escrowCase.id);
    await markDelivered(seller.user.id, escrowCase.id);
    const released = await confirmReceipt(buyer.user.id, escrowCase.id);
    expect(released.status).toBe('RELEASED');

    const sellerAfter = await balanceOf(seller.user.id);
    const fee = escrowCase.feeAmount;
    expect(sellerAfter - sellerBefore).toBe(TZS(100_000) - fee);
    if (fee > 0n) {
      const feeWallet = await getSystemWallet(prisma, systemWalletCode.fees('TZS'));
      expect(feeWallet.balance >= fee).toBe(true);
    }
    // The escrow wallet is empty at the end; exactly one payout exists.
    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: funded.escrowWalletId! } });
    expect(walletAfter.balance).toBe(0n);
    expect(await prisma.escrowPayout.count({ where: { caseId: escrowCase.id } })).toBe(1);

    // A second confirm is rejected — no double release.
    await expect(confirmReceipt(buyer.user.id, escrowCase.id)).rejects.toMatchObject({ code: 'ESCROW_ILLEGAL_TRANSITION' });
  }, 180_000);

  it('stops release during a dispute and supports an authorised refund', async () => {
    const { buyer, seller, escrowCase } = await makeDeal(60_000);
    await acceptTerms(seller.user.id, escrowCase.id);
    await fundCase(buyer.user.id, escrowCase.id, '5283', randomUUID());
    await markFulfilment(seller.user.id, escrowCase.id);

    const dispute = await openDispute(buyer.user.id, escrowCase.id, {
      reason: 'Item never arrived and the seller stopped responding',
      requestedOutcome: 'REFUND_BUYER',
    });

    // While disputed, neither the buyer's confirm nor the seller's refund can proceed.
    await expect(confirmReceipt(buyer.user.id, escrowCase.id)).rejects.toMatchObject({ code: 'ESCROW_ILLEGAL_TRANSITION' });
    await expect(agreeRefund(seller.user.id, escrowCase.id)).rejects.toMatchObject({ code: 'ESCROW_ILLEGAL_TRANSITION' });

    const admin = await adminUser();
    const buyerBefore = await balanceOf(buyer.user.id);
    const resolved = await resolveDispute(admin.id, dispute.id, {
      outcome: 'REFUND_BUYER',
      note: 'Seller unresponsive for 14 days; full refund awarded.',
    });
    expect(resolved.status).toBe('REFUNDED');
    expect(await balanceOf(buyer.user.id)).toBe(buyerBefore + TZS(60_000)); // full refund, no fee

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: resolved.escrowWalletId! } });
    expect(wallet.balance).toBe(0n);
  }, 180_000);

  it('supports a seller-agreed refund before delivery', async () => {
    const { buyer, seller, escrowCase } = await makeDeal(40_000);
    await acceptTerms(seller.user.id, escrowCase.id);
    await fundCase(buyer.user.id, escrowCase.id, '5283', randomUUID());

    const buyerBefore = await balanceOf(buyer.user.id);
    const refunded = await agreeRefund(seller.user.id, escrowCase.id);
    expect(refunded.status).toBe('REFUNDED');
    expect(await balanceOf(buyer.user.id)).toBe(buyerBefore + TZS(40_000));
  }, 180_000);
});
