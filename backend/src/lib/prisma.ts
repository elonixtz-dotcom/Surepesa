import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// Interactive-transaction limits. Neon adds network latency and payments may wait on row
// locks held by concurrent payments, so the Prisma defaults (2s/5s) are too tight.
export const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;
