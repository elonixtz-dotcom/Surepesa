import { RequestHandler } from 'express';
import type { JWTPayload } from 'jose';
import { User } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { loadJose } from '../lib/jose';

/**
 * Neon Auth (Managed Better Auth) issues short-lived EdDSA JWTs. The Flutter app signs in
 * against Neon Auth, calls `token()`, and sends `Authorization: Bearer <jwt>` to this API.
 * We verify signature, issuer and audience against the branch's JWKS — nothing else from
 * the client is trusted.
 */
let jwks: ReturnType<Awaited<ReturnType<typeof loadJose>>['createRemoteJWKSet']> | undefined;
const issuer = new URL(env.NEON_AUTH_BASE_URL).origin;

export interface AuthClaims extends JWTPayload {
  sub: string;
  email?: string;
  name?: string;
  emailVerified?: boolean;
  banned?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthClaims;
      user?: User;
    }
  }
}

export async function verifyAccessToken(token: string): Promise<AuthClaims> {
  const { createRemoteJWKSet, jwtVerify } = await loadJose();
  jwks ??= createRemoteJWKSet(new URL(env.NEON_AUTH_JWKS_URL));
  const { payload } = await jwtVerify(token, jwks, { issuer, audience: issuer });
  if (!payload.sub) throw new Error('Token has no subject');
  return payload as AuthClaims;
}

/** Requires a valid Neon Auth JWT and loads (or provisions) the matching SurePesa user. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError('UNAUTHENTICATED', 'Sign in required', 401));
  }

  let claims: AuthClaims;
  try {
    claims = await verifyAccessToken(header.slice(7));
  } catch {
    return next(new AppError('INVALID_TOKEN', 'Session expired or invalid — sign in again', 401));
  }
  if (claims.banned) return next(new AppError('ACCOUNT_BANNED', 'This account has been suspended', 403));

  // First authenticated request creates the SurePesa account linked to the Neon Auth identity.
  const user = await prisma.user.upsert({
    where: { authUserId: claims.sub },
    update: {},
    create: { authUserId: claims.sub, email: claims.email },
  });
  if (user.status === 'SUSPENDED' || user.status === 'CLOSED') {
    return next(new AppError('ACCOUNT_NOT_ACTIVE', 'This account is not active', 403));
  }

  req.auth = claims;
  req.user = user;
  next();
};
