import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { deposit, sendMoney, withdraw } from '../src/services/payment.service';

/**
 * Synthetic demo data for the back-office console (SOP §3.5: no real customer data outside
 * production). Every record uses @demo.surepesa.test emails and +25569xxxxxxx numbers so it
 * is easy to identify and purge. Safe to re-run: existing demo customers are reused.
 */
const TZS = (major: number) => BigInt(major) * 100n;

const PEOPLE = [
  ['Halca', 'Alane', '+255690000001', 450_000],
  ['John', 'Mushi', '+255690000002', 120_000],
  ['Stacy', 'Kimaro', '+255690000003', 80_000],
  ['Zavan', 'Mollel', '+255690000004', 300_000],
  ['Luna', 'Massawe', '+255690000005', 60_000],
  ['Baraka', 'Ndege', '+255690000006', 25_000],
  ['Neema', 'Shirima', '+255690000007', 0],
  ['Juma', 'Hamisi', '+255690000008', 150_000],
] as const;

async function demoCustomer(first: string, last: string, phone: string) {
  const email = `${first}.${last}@demo.surepesa.test`.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email }, include: { paymentMethods: true } });
  if (existing) return { user: existing, methodId: existing.paymentMethods[0]!.id, created: false };
  const user = await prisma.user.create({
    data: {
      email,
      phoneNumber: phone,
      status: 'ACTIVE',
      kycStatus: 'APPROVED',
      profile: { create: { firstName: first, lastName: last, region: 'Dar es Salaam' } },
      paymentMethods: {
        create: { type: 'MOBILE_MONEY', provider: 'SIMULATED', label: 'M-Pesa', accountNumber: phone.replace('+255', '0'), maskedNumber: `0${phone.slice(4, 6)}* *** ${phone.slice(-3)}`, status: 'VERIFIED' },
      },
    },
    include: { paymentMethods: true },
  });
  return { user, methodId: user.paymentMethods[0]!.id, created: true };
}

type Customer = Awaited<ReturnType<typeof demoCustomer>>;

async function main() {
  const customers = [];
  for (const [first, last, phone, funds] of PEOPLE) {
    const c = await demoCustomer(first, last, phone);
    if (c.created && funds > 0) {
      await deposit({ userId: c.user.id, paymentMethodId: c.methodId, amount: TZS(funds), idempotencyKey: randomUUID() });
    }
    customers.push(c);
    console.log(`${c.created ? 'created' : 'exists '} ${first} ${last}`);
  }
  if (!customers.some((c) => c.created)) {
    console.log('Demo data already present.');
    return;
  }

  const [halca, john, stacy, zavan, luna, baraka, neema, juma] = customers as [Customer, Customer, Customer, Customer, Customer, Customer, Customer, Customer];
  const send = (from: Customer, to: Customer, amount: number, description: string) =>
    sendMoney({ senderUserId: from.user.id, recipientUserId: to.user.id, amount: TZS(amount), idempotencyKey: randomUUID(), description });

  await send(halca, john, 25_000, 'Rent share');
  await send(zavan, stacy, 40_000, 'School fees');
  await send(juma, luna, 15_000, 'Lunch');
  const wrongNumber = await send(halca, neema, 35_000, 'Payment for goods');
  await send(john, baraka, 10_000, 'Transport');
  await send(baraka, halca, 90_000, 'Supplier payment'); // fails: insufficient funds
  await send(luna, juma, 5_000, 'Airtime');
  await withdraw({ userId: zavan.user.id, paymentMethodId: zavan.methodId, amount: TZS(50_000), idempotencyKey: randomUUID() });

  // Neema has not been verified yet and has a pending KYC submission.
  await prisma.user.update({ where: { id: neema.user.id }, data: { kycStatus: 'PENDING' } });
  await prisma.kycSubmission.create({
    data: { userId: neema.user.id, fullName: 'Neema Shirima', idType: 'NATIONAL_ID', idNumber: '19950312-14111-00002-17', status: 'PENDING' },
  });

  // Halca says the 35,000 went to the wrong number.
  const agent = await prisma.adminUser.findFirst({ where: { role: 'SUPPORT' } });
  if (agent) {
    await prisma.supportCase.create({
      data: {
        reference: `CS-${randomUUID().slice(0, 8).toUpperCase()}`,
        userId: halca.user.id,
        transactionId: wrongNumber.id,
        category: 'WRONG_RECIPIENT',
        priority: 'HIGH',
        subject: 'Sent TZS 35,000 to the wrong number',
        createdById: agent.id,
        assignedToId: agent.id,
        notes: { create: { authorId: agent.id, body: `Customer called: intended recipient was +255690000017, not Neema. Reference ${wrongNumber.reference}.` } },
      },
    });
  }
  console.log('Demo transactions, KYC submission and support case created.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
