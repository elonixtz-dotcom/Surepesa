import { Router } from 'express';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { checkStorage } from '../lib/storage';

export const healthRouter = Router();

async function check(fn: () => Promise<unknown>): Promise<'ok' | 'unreachable'> {
  try {
    return (await fn()) === false ? 'unreachable' : 'ok';
  } catch {
    return 'unreachable';
  }
}

/** Liveness of every backing service: Postgres, Neon Auth (JWKS) and object storage. */
healthRouter.get('/', async (_req, res) => {
  const [database, auth, storage] = await Promise.all([
    check(() => prisma.$queryRaw`SELECT 1`),
    check(async () => (await fetch(env.NEON_AUTH_JWKS_URL, { signal: AbortSignal.timeout(10_000) })).ok),
    check(checkStorage),
  ]);
  const ok = database === 'ok' && auth === 'ok' && storage === 'ok';
  res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', database, auth, storage, time: new Date().toISOString() });
});
