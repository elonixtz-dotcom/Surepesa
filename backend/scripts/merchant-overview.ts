import { writeFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma';
import { jsonReplacer } from '../src/lib/json';
import { merchantOverview } from '../src/routes/merchant.routes';

/**
 * Prints the merchant dashboard payload for a merchant code, without signing in.
 * Usage: tsx scripts/merchant-overview.ts SPM100001 [out.json]
 */
async function main() {
  const [code = 'SPM100001', out] = process.argv.slice(2);
  const business = await prisma.business.findUniqueOrThrow({ where: { merchantCode: code } });
  const json = JSON.stringify(await merchantOverview(business.ownerId, business.id), jsonReplacer, 2);
  if (out) writeFileSync(out, json + '\n');
  else console.log(json);
}

main().finally(() => prisma.$disconnect());
