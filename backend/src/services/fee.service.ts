import { TransactionType } from '@prisma/client';
import { basisPoints } from '../lib/money';
import { prisma } from '../lib/prisma';

/**
 * Fee schedule. Rules live in the `fee_rules` table so pricing and regulatory caps (for
 * example the Bank of Tanzania's wallet-to-bank caps) change without a deploy. The newest
 * active rule per transaction type whose `effectiveFrom` has passed wins; types without a
 * rule fall back to DEFAULT_RULES. All values in minor units / basis points.
 */
export interface FeeRuleValues {
  bps: number; // percentage component, 100 bps = 1%
  min: bigint;
  max: bigint | null;
}

export const DEFAULT_RULES: Partial<Record<TransactionType, FeeRuleValues>> = {
  P2P_TRANSFER: { bps: 0, min: 0n, max: null }, // free during the prototype
  MERCHANT_PAYMENT: { bps: 0, min: 0n, max: null }, // merchant-side MDR would be charged at settlement
  WITHDRAWAL: { bps: 50, min: 50_000n, max: 500_000n }, // 0.5%, TZS 500 – 5,000
  DEPOSIT: { bps: 0, min: 0n, max: null },
};

export function applyFeeRule(rule: FeeRuleValues | undefined, amount: bigint): bigint {
  if (!rule) return 0n;
  let fee = basisPoints(amount, rule.bps);
  if (fee < rule.min) fee = rule.min;
  if (rule.max !== null && fee > rule.max) fee = rule.max;
  return fee;
}

/** Fee under the built-in schedule only (no database). */
export function calculateFee(type: TransactionType, amount: bigint): bigint {
  return applyFeeRule(DEFAULT_RULES[type], amount);
}

const CACHE_MS = 60_000;
let cache: { at: number; rules: Map<TransactionType, FeeRuleValues> } | null = null;

async function activeRules(): Promise<Map<TransactionType, FeeRuleValues>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rules;
  const rows = await prisma.feeRule.findMany({
    where: { active: true, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: 'desc' },
  });
  const rules = new Map<TransactionType, FeeRuleValues>();
  for (const r of rows) {
    if (!rules.has(r.transactionType)) rules.set(r.transactionType, { bps: r.bps, min: r.minFee, max: r.maxFee });
  }
  cache = { at: Date.now(), rules };
  return rules;
}

/** The rule currently in force for a type: database first, then the built-in default. */
export async function currentFeeRule(type: TransactionType): Promise<FeeRuleValues | undefined> {
  return (await activeRules()).get(type) ?? DEFAULT_RULES[type];
}

/** Fee the customer pays for this payment, as shown on the confirmation screen and charged. */
export async function quoteFee(type: TransactionType, amount: bigint): Promise<bigint> {
  return applyFeeRule(await currentFeeRule(type), amount);
}

/** Call after changing fee_rules so the next payment uses the new schedule. */
export function invalidateFeeCache(): void {
  cache = null;
}
