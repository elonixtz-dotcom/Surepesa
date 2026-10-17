import type { MerchantOverview, PaymentRequest } from './types';
import { demoOverview, demoPaymentRequest } from '../demo/fixtures';

/**
 * Talks to Neon Auth (sign-in, session) and the SurePesa API.
 *
 * Neon Auth issues a session cookie on sign-in; `/auth/token` exchanges it for a short-lived
 * JWT that the API accepts. In development both sit behind the Vite proxy (/auth, /v1), so the
 * cookie is first-party. `npm run demo` serves sample data instead and needs neither.
 */
export const DEMO = import.meta.env.MODE === 'demo';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

let jwt: { token: string; expiresAt: number } | null = null;

async function authFetch(path: string, init: RequestInit = {}) {
  return fetch(`/auth/${path}`, { ...init, credentials: 'include', headers: { 'content-type': 'application/json', ...init.headers } });
}

export async function signIn(email: string, password: string): Promise<void> {
  if (DEMO) return;
  const res = await authFetch('sign-in/email', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.message ?? 'Email or password is incorrect', res.status, body?.code);
  }
  jwt = null;
}

export async function signOut(): Promise<void> {
  jwt = null;
  if (!DEMO) await authFetch('sign-out', { method: 'POST', body: '{}' }).catch(() => undefined);
}

/** A JWT for the API, refreshed a minute before it expires. Null when there is no session. */
async function accessToken(): Promise<string | null> {
  if (jwt && jwt.expiresAt - Date.now() > 60_000) return jwt.token;
  const res = await authFetch('token');
  if (!res.ok) return null;
  const token = (await res.json().catch(() => null))?.token as string | undefined;
  if (!token) return null;
  const exp = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).exp as number;
  jwt = { token, expiresAt: exp * 1000 };
  return token;
}

async function api<T>(path: string): Promise<T> {
  const token = await accessToken();
  if (!token) throw new ApiError('Please sign in', 401, 'SIGNED_OUT');
  const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error?.message ?? 'Something went wrong', res.status, body?.error?.code);
  return body as T;
}

export async function loadOverview(businessId?: string): Promise<MerchantOverview> {
  if (DEMO) return demoOverview(businessId);
  return api<MerchantOverview>(`/v1/merchant/overview${businessId ? `?businessId=${businessId}` : ''}`);
}

/** A single-use TANQR payment request for a fixed amount (expires after 15 minutes). */
export async function createPaymentRequest(merchantCode: string, amount: string): Promise<PaymentRequest> {
  if (DEMO) return demoPaymentRequest(merchantCode, amount);
  return api<PaymentRequest>(`/v1/merchants/${encodeURIComponent(merchantCode)}/qr?amount=${encodeURIComponent(amount)}`);
}

/** True if a Neon Auth session already exists (returning visitor). */
export async function hasSession(): Promise<boolean> {
  if (DEMO) return true;
  return (await accessToken()) !== null;
}
