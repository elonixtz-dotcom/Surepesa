import { prisma } from '../src/lib/prisma';
import { syncRails } from '../src/services/rail-sync.service';

/**
 * One rail-sync pass: query rails about deposits/withdrawals still waiting for an answer.
 * For schedulers (cron) when the API runs with RAIL_SYNC_INTERVAL_MS=0.
 * Exit code 1 if any check errored.
 */
async function main() {
  const summary = await syncRails(500);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.errors ? 1 : 0;
}

main().finally(() => prisma.$disconnect());
