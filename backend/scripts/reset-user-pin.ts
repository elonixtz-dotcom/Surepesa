import { prisma } from '../src/lib/prisma';

/**
 * Clears a customer's transaction PIN after a verified "forgot PIN" request.
 * The user sets a fresh PIN from the app on their next payment (no current PIN required
 * once pinHash is null).
 *
 *   npx tsx scripts/reset-user-pin.ts <name|phone|email>
 *
 * Prints the matched account(s) first; with exactly one match it clears the PIN.
 */
async function main() {
  const [query] = process.argv.slice(2);
  if (!query) {
    console.error('Usage: npx tsx scripts/reset-user-pin.ts <name|phone|email>');
    process.exit(1);
  }

  const matches = await prisma.user.findMany({
    where: {
      OR: [
        { phoneNumber: { contains: query } },
        { email: { contains: query, mode: 'insensitive' } },
        { profile: { is: { firstName: { contains: query, mode: 'insensitive' } } } },
        { profile: { is: { lastName: { contains: query, mode: 'insensitive' } } } },
      ],
    },
    include: { profile: true },
    take: 10,
  });

  if (matches.length === 0) {
    console.error(`No customer found matching "${query}"`);
    process.exit(1);
  }

  for (const u of matches) {
    const name = u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : '(no profile)';
    console.log(
      `${u.id}  ${name}  phone=${u.phoneNumber ?? '-'}  email=${u.email ?? '-'}  status=${u.status}  pinSet=${!!u.pinHash}  pinLockedAt=${u.pinLockedAt?.toISOString() ?? '-'}`,
    );
  }

  if (matches.length > 1) {
    console.error('\nMore than one match — re-run with a unique phone number or email. No changes made.');
    process.exit(1);
  }

  const user = matches[0]!;
  if (!user.pinHash) {
    console.log('\nThis account has no PIN set — nothing to reset.');
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { pinHash: null, pinAttempts: 0, pinLockedAt: null },
  });
  console.log('\nPIN cleared. The user can set a new PIN from the app on their next payment.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
