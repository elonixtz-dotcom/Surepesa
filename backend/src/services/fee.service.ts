import { TransactionType } from '@prisma/client';
import { basisPoints } from '../lib/money';

/**
 * Fee schedule. Kept in one place so pricing can later move to a database table
 * without touching payment logic. All values in minor units / basis points.
 */
interface FeeRule {
  bps: number; // percentage component, 100 bps = 1%
  min: bigint;
  max: bigint | null;
}

const RULES: Partial<Record<TransactionType, FeeRule>> = {
  P2P_TRANSFER: { bps: 0, min: 0n, max: null }, // free during the prototype
  MERCHANT_PAYMENT: { bps: 0, min: 0n, max: null }, // merchant-side MDR would be charged at settlement
  WITHDRAWAL: { bps: 50, min: 50_000n, max: 500_000n }, // 0.5%, TZS 500 – 5,000
  DEPOSIT: { bps: 0, min: 0n, max: null },
};

export function calculateFee(type: TransactionType, amount: bigint): bigint {
  const rule = RULES[type];
  if (!rule) return 0n;
  let fee = basisPoints(amount, rule.bps);
  if (fee < rule.min) fee = rule.min;
  if (rule.max !== null && fee > rule.max) fee = rule.max;
  return fee;
}
