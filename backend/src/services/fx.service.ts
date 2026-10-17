import { ExchangeRate, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Exchange-rate service. Payment code asks this service for a rate and stores the
 * returned rate id + value on the transaction; rates are never hardcoded in payment logic.
 */
export async function getCurrentRate(db: Db, base: string, quote: string, at = new Date()): Promise<ExchangeRate> {
  const rate = await db.exchangeRate.findFirst({
    where: {
      baseCurrency: base,
      quoteCurrency: quote,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!rate) throw new AppError('FX_RATE_UNAVAILABLE', `No ${base}/${quote} rate available`, 422);
  return rate;
}

/**
 * Converts minor units of `fromMinorUnits` precision into the target currency,
 * rounding down (the customer never receives more than the rate allows).
 */
export function convertMinor(
  amount: bigint,
  rate: Prisma.Decimal,
  fromMinorUnits: number,
  toMinorUnits: number,
): bigint {
  const major = new Prisma.Decimal(amount.toString()).div(new Prisma.Decimal(10).pow(fromMinorUnits));
  const target = major.mul(rate).mul(new Prisma.Decimal(10).pow(toMinorUnits));
  return BigInt(target.toFixed(0, Prisma.Decimal.ROUND_DOWN));
}
