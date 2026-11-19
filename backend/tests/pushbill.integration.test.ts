import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { deposit } from '../src/services/payment.service';
import { quoteFee } from '../src/services/fee.service';
import { setPin } from '../src/services/pin.service';
import { getOrCreateUserWallet } from '../src/services/wallet.service';
import { simulatedVoiceCarrier } from '../src/providers';
import {
  acceptPushBill,
  authorisePushBill,
  confirmPushBill,
  createPushBill,
  declinePushBill,
  handleVoiceEvent,
  requestCall,
} from '../src/modules/pushbill/pushbill.service';

/**
 * PushBill ★ full-journey tests against a real PostgreSQL database (blueprint §6/§17).
 * Point DATABASE_URL at a Neon *branch* used only for tests, then run:
 *   npx prisma migrate deploy && npx prisma db seed && npx vitest run tests/pushbill.integration.test.ts
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const TZS = (major: number) => BigInt(major) * 100n;
const phone = () => `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function createUser(withPin?: string) {
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
  if (withPin) await setPin(user.id, withPin);
  return { user, methodId: user.paymentMethods[0]!.id };
}

async function fundedUser(majorTzs: number, pin: string) {
  const u = await createUser(pin);
  const txn = await deposit({ userId: u.user.id, paymentMethodId: u.methodId, amount: TZS(majorTzs), idempotencyKey: randomUUID() });
  expect(txn.status).toBe('SUCCESS');
  return u;
}

async function createMerchant() {
  const owner = await createUser();
  const business = await prisma.business.create({
    data: {
      ownerId: owner.user.id,
      merchantCode: `SPM${randomUUID().slice(0, 6).toUpperCase()}`,
      legalName: 'Test Merchant Ltd',
      tradingName: 'Test Shop',
      phoneNumber: phone(),
    },
  });
  return business;
}

const balanceOf = async (userId: string) => (await getOrCreateUserWallet(prisma, userId, 'TZS')).balance;
const businessWallet = async (businessId: string) =>
  prisma.wallet.findFirst({ where: { businessId, currencyCode: 'TZS' } });

describe.skipIf(!hasDb)('pushbill journey (database)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('pays only after call + both confirmations + payer PIN', { timeout: 180_000 }, async () => {
    const requester = await createUser();
    const payer = await fundedUser(100_000, '4839');
    const merchant = await createMerchant();
    const amount = TZS(25_000);
    const fee = await quoteFee('MERCHANT_PAYMENT', amount);

    // Create: destination verified, payer selected and notified.
    const session = await createPushBill({
      requesterId: requester.user.id,
      destinationKind: 'MERCHANT_CODE',
      destination: merchant.merchantCode,
      payerPhone: payer.user.phoneNumber!,
      amount,
      note: 'lunch',
      idempotencyKey: randomUUID(),
    });
    expect(session.reference).toMatch(/^PB-[0-9A-Z]{8}$/);
    expect(session.state).toBe('PAYER_NOTIFIED');
    expect(session.destinationLabel).toBe('Test Shop');

    // Idempotent create: same key returns the same session.
    const retry = await createPushBill({
      requesterId: requester.user.id,
      destinationKind: 'MERCHANT_CODE',
      destination: merchant.merchantCode,
      payerPhone: payer.user.phoneNumber!,
      amount,
      idempotencyKey: session.idempotencyKey!,
    });
    expect(retry.id).toBe(session.id);

    // Authorisation before the call is impossible.
    await expect(authorisePushBill(payer.user.id, session.id, '4839', randomUUID()))
      .rejects.toMatchObject({ code: 'PUSHBILL_ILLEGAL_TRANSITION' });

    // Payer accepts, call is bridged, carrier reports CONNECTED.
    await acceptPushBill(payer.user.id, session.id);
    const { providerCallId } = await requestCall(requester.user.id, session.id);
    await handleVoiceEvent(simulatedVoiceCarrier, { eventId: `e-${randomUUID()}`, providerCallId, status: 'CONNECTED' });
    expect((await prisma.pushBillSession.findUniqueOrThrow({ where: { id: session.id } })).state).toBe('CALL_CONNECTED');

    // Both parties confirm; a duplicate confirmation from the same party is rejected.
    await confirmPushBill(requester.user.id, session.id, 'IN_APP', 'CONFIRMED');
    const afterBoth = await confirmPushBill(payer.user.id, session.id, 'IN_APP', 'CONFIRMED');
    expect(afterBoth.state).toBe('AWAITING_PAYER_AUTH');

    // Wrong PIN is refused; the right PIN pays exactly once.
    await expect(authorisePushBill(payer.user.id, session.id, '0000', randomUUID()))
      .rejects.toMatchObject({ code: 'WRONG_PIN' });
    const paid = await authorisePushBill(payer.user.id, session.id, '4839', randomUUID());
    expect(paid.state).toBe('PAID');
    expect(paid.paymentTransactionId).toBeTruthy();

    expect(await balanceOf(payer.user.id)).toBe(TZS(100_000) - amount - fee);
    expect((await businessWallet(merchant.id))?.balance).toBe(amount);

    const events = await prisma.pushBillEvent.findMany({ where: { sessionId: session.id }, orderBy: { id: 'asc' } });
    expect(events.map((e) => e.toState)).toEqual([
      'DESTINATION_VERIFIED',
      'PAYER_SELECTED',
      'PAYER_NOTIFIED',
      'CALL_REQUESTED',
      'CALLING',
      'CALL_CONNECTED',
      'BOTH_PARTIES_CONFIRMED',
      'AWAITING_PAYER_AUTH',
      'PAYMENT_PROCESSING',
      'PAID',
    ]);
  });

  it('a declined request never moves money', async () => {
    const requester = await createUser();
    const payer = await fundedUser(50_000, '7264');
    const merchant = await createMerchant();
    const session = await createPushBill({
      requesterId: requester.user.id,
      destinationKind: 'MERCHANT_CODE',
      destination: merchant.merchantCode,
      payerPhone: payer.user.phoneNumber!,
      amount: TZS(10_000),
      idempotencyKey: randomUUID(),
    });
    const declined = await declinePushBill(payer.user.id, session.id);
    expect(declined.state).toBe('DECLINED');
    await expect(authorisePushBill(payer.user.id, session.id, '7264', randomUUID()))
      .rejects.toMatchObject({ code: 'PUSHBILL_ILLEGAL_TRANSITION' });
    expect(await balanceOf(payer.user.id)).toBe(TZS(50_000));
  });

  it('no answer means no payment authorisation', async () => {
    const requester = await createUser();
    const payer = await fundedUser(50_000, '9153');
    const merchant = await createMerchant();
    const session = await createPushBill({
      requesterId: requester.user.id,
      destinationKind: 'MERCHANT_CODE',
      destination: merchant.merchantCode,
      payerPhone: payer.user.phoneNumber!,
      amount: TZS(10_000),
      idempotencyKey: randomUUID(),
    });
    await acceptPushBill(payer.user.id, session.id);
    const { providerCallId } = await requestCall(payer.user.id, session.id);
    const res = await handleVoiceEvent(simulatedVoiceCarrier, { eventId: `e-${randomUUID()}`, providerCallId, status: 'NO_ANSWER' });
    expect(res.outcome).toBe('APPLIED');
    expect((await prisma.pushBillSession.findUniqueOrThrow({ where: { id: session.id } })).state).toBe('NO_ANSWER');
    expect(await balanceOf(payer.user.id)).toBe(TZS(50_000));
  });

  it('a mismatched confirmation ends the request with no payment', async () => {
    const requester = await createUser();
    const payer = await fundedUser(50_000, '6482');
    const merchant = await createMerchant();
    const session = await createPushBill({
      requesterId: requester.user.id,
      destinationKind: 'MERCHANT_CODE',
      destination: merchant.merchantCode,
      payerPhone: payer.user.phoneNumber!,
      amount: TZS(10_000),
      idempotencyKey: randomUUID(),
    });
    await acceptPushBill(payer.user.id, session.id);
    const { providerCallId } = await requestCall(payer.user.id, session.id);
    await handleVoiceEvent(simulatedVoiceCarrier, { eventId: `e-${randomUUID()}`, providerCallId, status: 'CONNECTED' });
    const ended = await confirmPushBill(payer.user.id, session.id, 'IN_APP', 'MISMATCH');
    expect(ended.state).toBe('MISMATCH');
    await expect(authorisePushBill(payer.user.id, session.id, '6482', randomUUID()))
      .rejects.toMatchObject({ code: 'PUSHBILL_ILLEGAL_TRANSITION' });
    expect(await balanceOf(payer.user.id)).toBe(TZS(50_000));
  });

  it('redelivered voice events are no-ops', async () => {
    const requester = await createUser();
    const payer = await fundedUser(50_000, '5527');
    const merchant = await createMerchant();
    const session = await createPushBill({
      requesterId: requester.user.id,
      destinationKind: 'MERCHANT_CODE',
      destination: merchant.merchantCode,
      payerPhone: payer.user.phoneNumber!,
      amount: TZS(10_000),
      idempotencyKey: randomUUID(),
    });
    await acceptPushBill(payer.user.id, session.id);
    const { providerCallId } = await requestCall(payer.user.id, session.id);
    const event = { eventId: `e-${randomUUID()}`, providerCallId, status: 'CONNECTED' as const };
    expect((await handleVoiceEvent(simulatedVoiceCarrier, event)).outcome).toBe('APPLIED');
    expect((await handleVoiceEvent(simulatedVoiceCarrier, event)).outcome).toBe('ALREADY_APPLIED');
    expect((await prisma.pushBillSession.findUniqueOrThrow({ where: { id: session.id } })).state).toBe('CALL_CONNECTED');
  });
});
