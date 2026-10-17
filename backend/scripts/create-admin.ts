import { AdminRole } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { generatePassword, hashPassword } from '../src/lib/password';

/**
 * Creates a back-office staff account and prints a one-time password.
 *   npm run admin:create -- jane@surecom.co.tz "Jane Mrema" SUPPORT
 * Roles: SUPER_ADMIN (System Controller), SUPPORT (Customer Service), FINANCE, COMPLIANCE.
 */
async function main() {
  const [email, fullName, role] = process.argv.slice(2);
  if (!email || !fullName || !role || !(role in AdminRole)) {
    console.error('Usage: npm run admin:create -- <email> "<Full Name>" <SUPER_ADMIN|SUPPORT|FINANCE|COMPLIANCE>');
    process.exit(1);
  }
  const password = generatePassword();
  const admin = await prisma.adminUser.create({
    data: { email: email.toLowerCase(), fullName, role: role as AdminRole, passwordHash: await hashPassword(password) },
  });
  console.log(`Created ${admin.role} ${admin.email}`);
  console.log(`One-time password: ${password}`);
  console.log('Share it over a secure channel. It is not stored anywhere in plain text.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
