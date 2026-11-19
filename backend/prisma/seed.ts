import { PrismaClient } from '@prisma/client';
import { systemWalletCode } from '../src/services/wallet.service';

/**
 * Reference data the ledger needs: currencies, system wallets and a starting FX rate.
 * Safe to run repeatedly.
 */
const prisma = new PrismaClient();

const CURRENCIES = [
  { code: 'TZS', name: 'Tanzanian Shilling', minorUnits: 2, symbol: 'TSh' },
  { code: 'USD', name: 'US Dollar', minorUnits: 2, symbol: '$' },
];

async function main() {
  for (const c of CURRENCIES) {
    await prisma.currency.upsert({ where: { code: c.code }, update: {}, create: c });

    const systemWallets = [
      { code: systemWalletCode.float(c.code), kind: 'SYSTEM_FLOAT' as const, allowNegative: true },
      { code: systemWalletCode.fees(c.code), kind: 'SYSTEM_FEES' as const, allowNegative: false },
      { code: systemWalletCode.fx(c.code), kind: 'SYSTEM_FX' as const, allowNegative: true },
    ];
    for (const w of systemWallets) {
      await prisma.wallet.upsert({
        where: { systemCode: w.code },
        update: {},
        create: { kind: w.kind, systemCode: w.code, currencyCode: c.code, allowNegative: w.allowNegative },
      });
    }
  }

  const hasRate = await prisma.exchangeRate.findFirst({ where: { baseCurrency: 'USD', quoteCurrency: 'TZS' } });
  if (!hasRate) {
    // Placeholder for the prototype; replace with a rate feed (e.g. Bank of Tanzania) later.
    await prisma.exchangeRate.create({ data: { baseCurrency: 'USD', quoteCurrency: 'TZS', rate: '2500', source: 'MANUAL' } });
  }

  // Fee schedule as data (see fee.service.ts). Only seeded once, so later changes made in the
  // back office are never overwritten.
  if ((await prisma.feeRule.count()) === 0) {
    await prisma.feeRule.create({
      data: {
        transactionType: 'WITHDRAWAL',
        bps: 50,
        minFee: 50_000n,
        maxFee: 500_000n,
        note: 'Prototype pricing: 0.5%, TZS 500 – 5,000. Max matches the reported BoT wallet-to-bank cap (circular effective 2025-07-01); confirm against the official circular.',
      },
    });
  }

  console.log('Seed complete');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
