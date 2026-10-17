import { prisma } from '../src/lib/prisma';
import { reconcileLedger } from '../src/services/ledger.service';
import { jsonReplacer } from '../src/lib/json';

/** Checks every ledger invariant. Exit code 1 if anything is off. */
async function main() {
  const report = await reconcileLedger(prisma);
  console.log(JSON.stringify(report, jsonReplacer, 2));
  process.exitCode = report.ok ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
