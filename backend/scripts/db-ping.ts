import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/** Measures round-trip time to the pooled and direct Neon endpoints. */
async function ping(name: string, url: string | undefined) {
  if (!url) return console.log(`${name}: not set`);
  const db = new PrismaClient({ datasources: { db: { url } } });
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    console.log(`${name}: ok (${Date.now() - started} ms)`);
  } catch (err) {
    console.log(`${name}: FAILED — ${(err as Error).message.trim().split('\n').pop()}`);
  } finally {
    await db.$disconnect();
  }
}

(async () => {
  await ping('DATABASE_URL (pooled)', process.env.DATABASE_URL);
  await ping('DIRECT_URL', process.env.DIRECT_URL);
})();
