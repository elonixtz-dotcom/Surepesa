import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';
import { deposit, payMerchant, RAIL_MAX_CHECKS, refundPayment, withdraw } from '../src/services/payment.service';
import { checkRailNow } from '../src/services/rail-sync.service';
import { maskPhone } from '../src/services/receipt.service';

/**
 * Demo data for the real-rail features, on top of `npm run seed:demo` (run that first).
 * Synthetic only (SOP §3.5): the same @demo.surepesa.test customers and +25569xxxxxxx numbers.
 * Safe to re-run: skipped if the demo merchant already exists.
 *
 * Every demo customer gets the transaction PIN below, so the app's confirm flow can be tried.
 */
const DEMO_PIN = '2580';
const MERCHANT_CODE = 'SPM100001';
const TZS = (major: number) => BigInt(major) * 100n;

async function customer(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`Missing ${email}: run npm run seed:demo first`);
  return user;
}

/** Links an extra mobile-money account whose last digits pick the simulator's behaviour. */
async function account(userId: string, provider: string, number: string, label: string) {
  const accountNumber = `+255${number}`;
  return prisma.paymentMethod.upsert({
    where: { userId_type_provider_accountNumber: { userId, type: 'MOBILE_MONEY', provider, accountNumber } },
    update: {},
    create: { userId, type: 'MOBILE_MONEY', provider, label, accountName: label.toUpperCase(), accountNumber, maskedNumber: maskPhone(accountNumber)!, status: 'VERIFIED' },
  });
}

async function main() {
  if (await prisma.business.findUnique({ where: { merchantCode: MERCHANT_CODE } })) {
    console.log('Rail demo data already present.');
    return;
  }

  const emails = ['halca.alane', 'john.mushi', 'stacy.kimaro', 'zavan.mollel', 'luna.massawe', 'baraka.ndege', 'neema.shirima', 'juma.hamisi'];
  const people = await Promise.all(emails.map((e) => customer(`${e}@demo.surepesa.test`)));
  const [halca, john, stacy, zavan, luna, , , juma] = people as [typeof people[0], ...typeof people];

  const pinHash = await hashPassword(DEMO_PIN);
  await prisma.user.updateMany({ where: { id: { in: people.map((p) => p.id) } }, data: { pinHash, pinAttempts: 0, pinLockedAt: null } });
  console.log('Demo customers have a transaction PIN (see DEMO_PIN in this script).');

  // A merchant (Juma's restaurant) with sales and one partial refund.
  const business = await prisma.business.create({
    data: {
      ownerId: juma!.id,
      merchantCode: MERCHANT_CODE,
      legalName: 'Mama Ntilie Foods Ltd',
      tradingName: 'Mama Ntilie Restaurant',
      category: 'Restaurant',
      region: 'Dar es Salaam',
      phoneNumber: '+255690000008',
    },
  });
  const pay = (payerUserId: string, amount: number, description: string) =>
    payMerchant({ payerUserId, businessId: business.id, amount: TZS(amount), idempotencyKey: randomUUID(), description });
  const lunch = await pay(halca!.id, 18_000, 'Lunch for 3');
  await pay(stacy!.id, 6_500, 'Chai na maandazi');
  await pay(zavan!.id, 32_000, 'Office catering');
  await refundPayment({ transactionId: lunch.id, amount: TZS(6_000), reason: 'One meal was not served', actor: { type: 'SYSTEM' } });
  console.log(`Merchant ${MERCHANT_CODE}: 3 payments, 1 partial refund.`);

  // Stacy adds money from M-Pesa and has not approved the prompt on her phone yet.
  const stacyMpesa = await account(stacy!.id, 'MPESA_TZ', '690031111', 'Stacy M-Pesa');
  const pendingDeposit = await deposit({ userId: stacy!.id, paymentMethodId: stacyMpesa.id, amount: TZS(20_000), idempotencyKey: randomUUID() });

  // Zavan's payout timed out at the rail: funds held while SurePesa confirms.
  const zavanAirtel = await account(zavan!.id, 'AIRTEL_TZ', '690043333', 'Zavan Airtel Money');
  const timedOut = await withdraw({ userId: zavan!.id, paymentMethodId: zavanAirtel.id, amount: TZS(30_000), idempotencyKey: randomUUID() });

  // Luna's payout will come back rejected at the next status check and be refunded automatically.
  const lunaMixx = await account(luna!.id, 'YAS_TZ', '690054444', 'Luna Mixx');
  const rejected = await withdraw({ userId: luna!.id, paymentMethodId: lunaMixx.id, amount: TZS(10_000), idempotencyKey: randomUUID() });

  // John's payout never gets an answer: already escalated to Finance.
  const johnMpesa = await account(john!.id, 'MPESA_TZ', '690025555', 'John M-Pesa');
  const stuck = await withdraw({ userId: john!.id, paymentMethodId: johnMpesa.id, amount: TZS(15_000), idempotencyKey: randomUUID() });
  await prisma.transaction.update({ where: { id: stuck.id }, data: { railCheckCount: RAIL_MAX_CHECKS - 1 } });
  await checkRailNow(await prisma.transaction.findUniqueOrThrow({ where: { id: stuck.id }, include: { paymentMethod: true } }));

  for (const [label, t] of [
    ['Deposit waiting for phone approval', pendingDeposit],
    ['Payout that timed out', timedOut],
    ['Payout the rail will reject', rejected],
    ['Payout escalated to Finance', stuck],
  ] as const) {
    const now = await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } });
    console.log(`${label}: ${now.reference} ${now.status} rail=${now.railStatus}${now.escalatedAt ? ' ESCALATED' : ''}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
