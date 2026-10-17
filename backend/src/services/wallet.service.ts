import { Prisma, Wallet } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

type Db = Prisma.TransactionClient | typeof prisma;

/** System wallets are created by the seed; their codes are deterministic per currency. */
export const systemWalletCode = {
  /** Mirror of money sitting at the (currently simulated) external rail. */
  float: (currency: string, provider = 'SIMULATED') => `FLOAT_${provider}_${currency}`,
  fees: (currency: string) => `FEES_${currency}`,
  fx: (currency: string) => `FX_${currency}`,
};

export async function getSystemWallet(db: Db, code: string): Promise<Wallet> {
  const wallet = await db.wallet.findUnique({ where: { systemCode: code } });
  if (!wallet) throw new AppError('SYSTEM_WALLET_MISSING', `System wallet ${code} not found — run the seed`, 500);
  return wallet;
}

/**
 * Find-or-create that is safe under concurrency: Prisma's upsert is not atomic for compound
 * unique keys, so simultaneous first payments could both try to insert. The unique index
 * picks one winner and the others re-read it.
 */
async function findOrCreate(find: () => Promise<Wallet | null>, create: () => Promise<Wallet>): Promise<Wallet> {
  const existing = await find();
  if (existing) return existing;
  try {
    return await create();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await find();
      if (winner) return winner;
    }
    throw err;
  }
}

/** Returns the user's wallet in `currency`, creating it on first use. */
export async function getOrCreateUserWallet(db: Db, userId: string, currency = 'TZS'): Promise<Wallet> {
  return findOrCreate(
    () => db.wallet.findUnique({ where: { userId_currencyCode: { userId, currencyCode: currency } } }),
    () => db.wallet.create({ data: { kind: 'USER', userId, currencyCode: currency } }),
  );
}

export async function getOrCreateBusinessWallet(db: Db, businessId: string, currency = 'TZS'): Promise<Wallet> {
  return findOrCreate(
    () => db.wallet.findUnique({ where: { businessId_currencyCode: { businessId, currencyCode: currency } } }),
    () => db.wallet.create({ data: { kind: 'BUSINESS', businessId, currencyCode: currency } }),
  );
}
