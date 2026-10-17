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
  if (!res.ok) throw await authError(res, 'The email or password is incorrect.');
  jwt = null;
}

/** Friendly messages for Neon Auth (Better Auth) error codes. */
const AUTH_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'The email or password is incorrect.',
  USER_ALREADY_EXISTS: 'An account with this email already exists. Sign in instead.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with this email already exists. Sign in instead.',
  PASSWORD_TOO_SHORT: 'Use at least 8 characters for your password.',
  PASSWORD_TOO_LONG: 'That password is too long.',
  INVALID_EMAIL: 'Enter a valid email address.',
  EMAIL_NOT_VERIFIED: 'Verify your email address first. Check your inbox for the link.',
};

async function authError(res: Response, fallback: string): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  const code = body?.code ?? body?.error?.code;
  return new ApiError(AUTH_MESSAGES[code] ?? body?.message ?? body?.error?.message ?? fallback, res.status, code);
}

/**
 * Creates a Neon Auth account. Resolves 'signed-in' when a session was started, or
 * 'verify-email' when the account must be confirmed by email first.
 */
export async function signUp(name: string, email: string, password: string): Promise<'signed-in' | 'verify-email'> {
  if (DEMO) return 'signed-in';
  const res = await authFetch('sign-up/email', { method: 'POST', body: JSON.stringify({ name, email, password }) });
  if (!res.ok) throw await authError(res, 'We could not create your account. Please try again.');
  jwt = null;
  return (await accessToken()) ? 'signed-in' : 'verify-email';
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

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await accessToken();
  if (!token) throw new ApiError('Please sign in', 401, 'SIGNED_OUT');
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
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

export interface MerchantSession {
  email: string | null;
  name: string | null;
  phone: string | null;
  profileComplete: boolean;
  businesses: { id: string; tradingName: string; merchantCode: string }[];
}

/** Also provisions the SurePesa user on the first call after sign-up. */
export async function loadSession(): Promise<MerchantSession> {
  if (DEMO) return { email: 'demo@surepesa.test', name: 'JUMA HAMISI', phone: '+255 69* *** 008', profileComplete: true, businesses: [{ id: 'demo', tradingName: 'Mama Ntilie Restaurant', merchantCode: 'SPM100001' }] };
  await api('/v1/me');
  return api<MerchantSession>('/v1/merchant/session');
}

export async function saveProfile(input: { firstName: string; lastName: string; phoneNumber: string }): Promise<void> {
  if (DEMO) return;
  await api('/v1/me/onboarding', { method: 'POST', body: input });
}

export interface BusinessInput {
  legalName: string;
  tradingName: string;
  category: string;
  region: string;
  phoneNumber?: string;
  registrationNo?: string;
  tin?: string;
}

export async function registerBusiness(input: BusinessInput): Promise<{ id: string; merchantCode: string }> {
  if (DEMO) return { id: 'demo', merchantCode: 'SPM100001' };
  return api('/v1/merchant/businesses', { method: 'POST', body: input });
}
