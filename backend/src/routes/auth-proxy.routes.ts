import express, { Router } from 'express';
import { env } from '../config/env';

/**
 * Same-origin Neon Auth for the web portals: /auth/* -> NEON_AUTH_BASE_URL/*
 *
 * Browsers keep the Neon Auth session cookie first-party only if sign-in happens on the
 * portal's own origin. A plain Vercel rewrite cannot do that: it adds X-Forwarded-Host, which
 * Neon Auth rejects (INVALID_HOSTNAME). This proxy forwards a fixed allow-list of auth endpoints
 * with only the headers Neon Auth needs, and returns its cookies scoped to the portal.
 *
 * It never sees or stores passwords beyond passing the request body through.
 */
export const authProxyRouter = Router();

const ALLOWED = new Set([
  'sign-up/email',
  'sign-in/email',
  'sign-out',
  'get-session',
  'token',
  'forget-password',
  'request-password-reset',
  'reset-password',
  'verify-email',
  'send-verification-email',
]);

const FORWARD_REQUEST_HEADERS = ['content-type', 'cookie', 'origin', 'user-agent', 'accept', 'accept-language'];
const RETURN_RESPONSE_HEADERS = ['content-type', 'cache-control'];

authProxyRouter.all('/*path', express.raw({ type: () => true, limit: '32kb' }), async (req, res) => {
  const path = String(req.path).replace(/^\/+/, '');
  if (!ALLOWED.has(path)) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    return;
  }

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.header(name);
    if (value) headers.set(name, value);
  }
  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  const hasBody = !['GET', 'HEAD'].includes(req.method) && Buffer.isBuffer(req.body) && req.body.length > 0;

  let upstream: Response;
  try {
    upstream = await fetch(`${env.NEON_AUTH_BASE_URL}/${path}${query}`, {
      method: req.method,
      headers,
      body: hasBody ? new Uint8Array(req.body as Buffer) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    res.status(502).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Sign-in is temporarily unavailable. Please try again.' } });
    return;
  }

  res.status(upstream.status);
  for (const name of RETURN_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  // Re-scope cookies to the portal: drop any Domain attribute so they stay host-only there.
  const cookies = upstream.headers.getSetCookie().map((c) => c.replace(/;\s*Domain=[^;]*/gi, ''));
  if (cookies.length) res.setHeader('set-cookie', cookies);
  const location = upstream.headers.get('location');
  if (location) res.setHeader('location', location);
  res.send(Buffer.from(await upstream.arrayBuffer()));
});
