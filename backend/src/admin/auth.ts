import { RequestHandler } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import { AdminUser } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { verifyPassword } from '../lib/password';
import { can, Permission } from './permissions';
import { audit } from './audit';

/**
 * Staff authentication for the back-office console. Kept separate from customer identity
 * (Neon Auth): staff accounts live in `admin_users`, and their tokens are signed with a
 * different key and audience, so a customer token can never reach admin routes.
 */
const secret = new TextEncoder().encode(env.ADMIN_JWT_SECRET);
const ISSUER = 'surepesa-admin';
const AUDIENCE = 'surepesa-back-office';
const SESSION_HOURS = 8;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminUser;
    }
  }
}

export async function login(email: string, password: string, ip?: string) {
  const admin = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
  const invalid = new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);

  if (!admin) {
    // Same work as a real check, so response time does not reveal which emails exist.
    await verifyPassword(password, 'scrypt$32768$8$AAAAAAAAAAAAAAAAAAAAAA$AAAA');
    throw invalid;
  }
  if (!admin.isActive) throw new AppError('ACCOUNT_DISABLED', 'This staff account is disabled', 403);
  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', 423);
  }

  if (!(await verifyPassword(password, admin.passwordHash))) {
    const attempts = admin.failedLoginAttempts + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS;
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        failedLoginAttempts: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined,
      },
    });
    await audit({ actorId: admin.id, action: lock ? 'ADMIN_LOCKED_OUT' : 'ADMIN_LOGIN_FAILED', entityType: 'AdminUser', entityId: admin.id, ipAddress: ip });
    throw invalid;
  }

  const updated = await prisma.adminUser.update({
    where: { id: admin.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await audit({ actorId: admin.id, action: 'ADMIN_LOGIN', entityType: 'AdminUser', entityId: admin.id, ipAddress: ip });

  const token = await new SignJWT({ role: admin.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(admin.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret);
  return { token, admin: updated };
}

/** Verifies the staff token and reloads the account, so disabling a user takes effect immediately. */
export const requireAdmin: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new AppError('UNAUTHENTICATED', 'Sign in required', 401));
  try {
    const { payload } = await jwtVerify(header.slice(7), secret, { issuer: ISSUER, audience: AUDIENCE });
    const admin = await prisma.adminUser.findUnique({ where: { id: payload.sub ?? '' } });
    if (!admin || !admin.isActive) return next(new AppError('UNAUTHENTICATED', 'Session is no longer valid', 401));
    req.admin = admin;
    next();
  } catch {
    next(new AppError('UNAUTHENTICATED', 'Session expired. Sign in again.', 401));
  }
};

export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!req.admin || !can(req.admin.role, permission)) {
      return next(new AppError('FORBIDDEN', 'Your role does not allow this action', 403));
    }
    next();
  };
