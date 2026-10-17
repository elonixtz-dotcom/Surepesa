import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { hashPassword, verifyPassword } from '../lib/password';

/**
 * Transaction PIN: confirms every payment that moves money out of a wallet.
 * Stored as a scrypt hash; 5 wrong attempts lock it for 30 minutes.
 */
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MS = 30 * 60_000;

const PIN_RE = /^\d{4,6}$/;

/** Rejects PINs that are easy to guess: one repeated digit or a straight run (1234, 9876). */
export function assertStrongPin(pin: string): void {
  if (!PIN_RE.test(pin)) throw new AppError('INVALID_PIN_FORMAT', 'Your PIN must be 4 to 6 digits', 400);
  const digits = [...pin].map(Number);
  const repeated = digits.every((d) => d === digits[0]);
  const step = digits[1]! - digits[0]!;
  const run = Math.abs(step) === 1 && digits.every((d, i) => i === 0 || d - digits[i - 1]! === step);
  if (repeated || run) throw new AppError('WEAK_PIN', 'Choose a PIN that is harder to guess', 400);
}

export async function setPin(userId: string, pin: string, currentPin?: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.pinHash) {
    if (!currentPin) throw new AppError('CURRENT_PIN_REQUIRED', 'Enter your current PIN to change it', 400);
    await verifyPin(userId, currentPin);
  }
  assertStrongPin(pin);
  await prisma.user.update({
    where: { id: userId },
    data: { pinHash: await hashPassword(pin), pinAttempts: 0, pinLockedAt: null },
  });
}

/** Throws unless the PIN is right. Counts failures and locks the PIN after too many. */
export async function verifyPin(userId: string, pin: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.pinHash) throw new AppError('PIN_NOT_SET', 'Set a transaction PIN first', 409);

  if (user.pinLockedAt && Date.now() - user.pinLockedAt.getTime() < PIN_LOCK_MS) {
    const minutes = Math.ceil((PIN_LOCK_MS - (Date.now() - user.pinLockedAt.getTime())) / 60_000);
    throw new AppError('PIN_LOCKED', `Too many wrong PINs. Try again in ${minutes} minutes.`, 423);
  }

  if (await verifyPassword(pin, user.pinHash)) {
    if (user.pinAttempts || user.pinLockedAt) {
      await prisma.user.update({ where: { id: userId }, data: { pinAttempts: 0, pinLockedAt: null } });
    }
    return;
  }

  // Atomic increment, so parallel guesses cannot each see the same counter.
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { pinAttempts: { increment: 1 } },
  });
  if (updated.pinAttempts >= PIN_MAX_ATTEMPTS) {
    await prisma.user.update({ where: { id: userId }, data: { pinLockedAt: new Date(), pinAttempts: 0 } });
    throw new AppError('PIN_LOCKED', 'Too many wrong PINs. Your PIN is locked for 30 minutes.', 423);
  }
  const left = PIN_MAX_ATTEMPTS - updated.pinAttempts;
  throw new AppError('WRONG_PIN', `Wrong PIN. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`, 403);
}
