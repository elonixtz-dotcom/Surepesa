import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { AppError } from '../lib/errors';
import { prisma, TX_OPTIONS } from '../lib/prisma';

const KEY_LENGTH = 64;
const COST = 16_384;
const BLOCK = 8;
const PARALLEL = 1;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

function derive(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(pin, salt, KEY_LENGTH, { N: COST, r: BLOCK, p: PARALLEL, maxmem: 64 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashTransactionPin(pin: string): Promise<string> {
  if (!/^\d{6}$/.test(pin)) throw new AppError('INVALID_PIN_FORMAT', 'PIN must contain exactly six digits');
  const salt = randomBytes(16);
  const hash = await derive(pin, salt);
  return `scrypt$${COST}$${BLOCK}$${PARALLEL}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPinHash(pin: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  if (Number(n) !== COST || Number(r) !== BLOCK || Number(p) !== PARALLEL) return false;
  if (!/^[0-9a-f]{32}$/i.test(saltHex!) || !/^[0-9a-f]{128}$/i.test(hashHex!)) return false;
  const expected = Buffer.from(hashHex!, 'hex');
  const actual = await derive(pin, Buffer.from(saltHex!, 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Row-lock attempts and commit failed-attempt counters before returning an error. */
export async function verifyTransactionPin(userId: string, pin: string): Promise<void> {
  if (!/^\d{6}$/.test(pin)) throw new AppError('INVALID_PIN_FORMAT', 'Enter your six-digit transaction PIN');
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.pinHash) return 'PIN_NOT_SET';
    if (user.pinLockedAt && Date.now() - user.pinLockedAt.getTime() < LOCK_MS) return 'PIN_LOCKED';
    if (!(await verifyPinHash(pin, user.pinHash))) {
      const attempts = user.pinAttempts + 1;
      await tx.user.update({ where: { id: userId }, data: { pinAttempts: attempts, pinLockedAt: attempts >= MAX_ATTEMPTS ? new Date() : null } });
      return attempts >= MAX_ATTEMPTS ? 'PIN_LOCKED' : 'INVALID_PIN';
    }
    await tx.user.update({ where: { id: userId }, data: { pinAttempts: 0, pinLockedAt: null } });
    return 'OK';
  }, TX_OPTIONS);
  if (outcome === 'PIN_NOT_SET') throw new AppError('PIN_NOT_SET', 'Set a transaction PIN before making payments', 403);
  if (outcome === 'PIN_LOCKED') throw new AppError('PIN_LOCKED', 'Too many incorrect PIN attempts. Try again in 15 minutes', 423);
  if (outcome === 'INVALID_PIN') throw new AppError('INVALID_PIN', 'Incorrect transaction PIN', 401);
}

export async function setTransactionPin(userId: string, pin: string, currentPin?: string): Promise<void> {
  if (!/^\d{6}$/.test(pin)) throw new AppError('INVALID_PIN_FORMAT', 'PIN must contain exactly six digits');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.phoneVerifiedAt) throw new AppError('PHONE_VERIFICATION_REQUIRED', 'Verify your phone number before setting a transaction PIN', 403);
  if (user.pinHash) {
    if (!currentPin) throw new AppError('CURRENT_PIN_REQUIRED', 'Enter your current PIN to change it', 400);
    await verifyTransactionPin(userId, currentPin);
  }
  const pinHash = await hashTransactionPin(pin);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    await tx.user.update({ where: { id: userId }, data: { pinHash, pinAttempts: 0, pinLockedAt: null } });
    await tx.auditLog.create({
      data: {
        actorType: 'USER', actorId: userId,
        action: user.pinHash ? 'TRANSACTION_PIN_CHANGED' : 'TRANSACTION_PIN_SET',
        entityType: 'User', entityId: userId,
        before: { pinConfigured: Boolean(user.pinHash) }, after: { pinConfigured: true },
      },
    });
  }, TX_OPTIONS);
}
