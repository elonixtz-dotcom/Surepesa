import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { env } from '../config/env';
import { syncRails } from '../services/rail-sync.service';
import { expireOverdueSessions } from '../modules/pushbill/pushbill.service';
import { expireOverdueCases } from '../modules/escrow/escrow.service';
import { expireOverdueQuotes } from '../modules/borderless/borderless.service';

/**
 * Scheduled jobs, for hosts without a long-running process (Vercel Cron, or any external
 * scheduler). Vercel Cron calls with `Authorization: Bearer $CRON_SECRET`.
 */
export const cronRouter = Router();

function authorised(header: string | undefined): boolean {
  if (!env.CRON_SECRET || !header) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

cronRouter.get('/rail-sync', async (req, res) => {
  if (!env.CRON_SECRET) {
    res.status(503).json({ error: { code: 'CRON_DISABLED', message: 'Set CRON_SECRET to enable scheduled jobs' } });
    return;
  }
  if (!authorised(req.header('authorization'))) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Bad cron credentials' } });
    return;
  }
  res.json(await syncRails(200));
});

/** Expiry sweeps: PushBill sessions, escrow funding deadlines, FX quotes. */
cronRouter.get('/sweep-expiry', async (req, res) => {
  if (!env.CRON_SECRET) {
    res.status(503).json({ error: { code: 'CRON_DISABLED', message: 'Set CRON_SECRET to enable scheduled jobs' } });
    return;
  }
  if (!authorised(req.header('authorization'))) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Bad cron credentials' } });
    return;
  }
  const [pushBills, escrowCases, fxQuotes] = await Promise.all([
    expireOverdueSessions(),
    expireOverdueCases(),
    expireOverdueQuotes(),
  ]);
  res.json({ pushBills, escrowCases, fxQuotes });
});
