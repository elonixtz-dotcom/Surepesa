/** Back-office API client. The staff token lives in sessionStorage, so it ends with the browser tab. */

const TOKEN_KEY = 'sp_admin_token';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the session lasts for this page load only */
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/admin/v1${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the SurePesa API.');
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data?.error?.code ?? `HTTP_${res.status}`, data?.error?.message ?? 'Request failed');
  }
  return data as T;
}

// ── Shared response types ──

export type Permission =
  | 'overview:view' | 'customers:view' | 'customers:status' | 'transactions:view' | 'cases:manage' | 'cases:view'
  | 'approvals:request' | 'approvals:decide' | 'kyc:review' | 'audit:view' | 'system:view'
  | 'rails:manage' | 'fees:view' | 'fees:manage' | 'reports:view' | 'reports:export';

export interface Staff {
  id: string;
  email: string;
  fullName: string;
  role: 'SUPER_ADMIN' | 'SUPPORT' | 'FINANCE' | 'COMPLIANCE';
  roleLabel: string;
  permissions: Permission[];
  lastLoginAt: string | null;
}

export interface Party {
  kind: 'USER' | 'BUSINESS' | 'SYSTEM';
  id: string | null;
  name: string;
  detail: string | null;
}

export interface Txn {
  id: string;
  reference: string;
  type: string;
  status: string;
  amount: string;
  fee: string;
  currency: string;
  from: Party | null;
  to: Party | null;
  description: string | null;
  failureCode: string | null;
  failureReason: string | null;
  providerName: string | null;
  createdAt: string;
  completedAt: string | null;
  direction?: 'IN' | 'OUT';
}

export interface Page<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

export interface CaseSummary {
  id: string;
  reference: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  customer: { id: string; name: string; phoneNumber: string | null };
  transaction: { id: string; reference: string; status: string; type: string } | null;
  createdBy: { id: string; fullName: string };
  assignedTo: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  type: 'TRANSACTION_REVERSAL' | 'TRANSACTION_REFUND' | string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  /** TRANSACTION_REFUND only: minor units as a string. */
  amount: string | null;
  reason: string;
  transaction: Txn | null;
  case: { id: string; reference: string; subject: string } | null;
  requestedBy: { id: string; fullName: string; role: string };
  decidedBy: { id: string; fullName: string } | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}
