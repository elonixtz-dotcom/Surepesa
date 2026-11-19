import { prisma } from '../src/lib/prisma';
import { generatePassword, hashPassword } from '../src/lib/password';

/**
 * Resets the password for an existing back-office staff account and prints a new one-time password.
 *   npm run admin:reset-password -- jane@surecom.co.tz
 */
async function main() {
  const [email] = process.argv.slice(2);
  if (!email) {
    console.error('Usage: npm run admin:reset-password -- <email>');
    process.exit(1);
  }

  const normalized = email.toLowerCase();
  const existing = await prisma.adminUser.findUnique({ where: { email: normalized } });
  if (!existing) {
    console.error(`No staff account found for ${normalized}`);
    process.exit(1);
  }

  const password = generatePassword();
  const admin = await prisma.adminUser.update({
    where: { id: existing.id },
    data: {
      passwordHash: await hashPassword(password),
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  console.log(`Reset password for ${admin.role} ${admin.email}`);
  console.log(`New one-time password: ${password}`);
  console.log('Share it over a secure channel. It is not stored anywhere in plain text.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
