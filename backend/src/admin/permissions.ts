import { AdminRole } from '@prisma/client';

/**
 * Back-office permissions (SOP §9 roles, §16 approval matrix).
 *
 * - SUPER_ADMIN ("System Controller") oversees everything.
 * - SUPPORT ("Customer Service") can look up customers and request reversals, but cannot
 *   move money, review KYC documents or change account status.
 * - FINANCE decides reversal requests and watches reconciliation.
 * - COMPLIANCE reviews KYC and can suspend or reactivate accounts.
 *
 * Maker-checker: whoever requests a sensitive action can never approve it (enforced in the
 * approvals routes, independent of role).
 */
export const PERMISSIONS = {
  'overview:view': ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE'],
  'customers:view': ['SUPER_ADMIN', 'SUPPORT', 'FINANCE', 'COMPLIANCE'],
  'customers:status': ['SUPER_ADMIN', 'COMPLIANCE'],
  'transactions:view': ['SUPER_ADMIN', 'SUPPORT', 'FINANCE', 'COMPLIANCE'],
  'cases:manage': ['SUPER_ADMIN', 'SUPPORT'],
  'cases:view': ['SUPER_ADMIN', 'SUPPORT', 'FINANCE', 'COMPLIANCE'],
  'approvals:request': ['SUPER_ADMIN', 'SUPPORT', 'FINANCE'],
  'approvals:decide': ['SUPER_ADMIN', 'FINANCE'],
  'kyc:review': ['SUPER_ADMIN', 'COMPLIANCE'],
  'audit:view': ['SUPER_ADMIN', 'COMPLIANCE'],
  'system:view': ['SUPER_ADMIN', 'FINANCE'],
} as const satisfies Record<string, readonly AdminRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: AdminRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly AdminRole[]).includes(role);
}

export function permissionsFor(role: AdminRole): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: 'System Controller',
  SUPPORT: 'Customer Service',
  FINANCE: 'Finance',
  COMPLIANCE: 'Compliance',
};
