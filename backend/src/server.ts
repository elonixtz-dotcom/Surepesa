import { env } from './config/env';
import { createApp } from './app';
import { prisma } from './lib/prisma';
import { syncRails } from './services/rail-sync.service';

const server = createApp().listen(env.PORT, () => {
  console.log(`SurePesa API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// Ask rails about deposits/withdrawals without a final answer (callbacks get lost).
// One pass at a time; several API instances are safe because each row is claimed first.
let railSyncRunning = false;
const railSyncTimer =
  env.RAIL_SYNC_INTERVAL_MS > 0
    ? setInterval(async () => {
        if (railSyncRunning) return;
        railSyncRunning = true;
        try {
          const s = await syncRails();
          if (s.checked) console.log(`rail-sync: checked ${s.checked}, settled ${s.applied}, waiting ${s.waiting}, escalated ${s.escalated}, errors ${s.errors}`);
        } catch (err) {
          console.error('rail-sync pass failed', err);
        } finally {
          railSyncRunning = false;
        }
      }, env.RAIL_SYNC_INTERVAL_MS)
    : undefined;

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  if (railSyncTimer) clearInterval(railSyncTimer);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
