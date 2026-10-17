import { LedgerEntryType, Prisma, WalletStatus } from '@prisma/client';
import { LedgerInvariantError, PaymentRejectedError } from '../lib/errors';

/**
 * The ledger is the only code allowed to change wallet balances.
 *
 * A posting is a set of signed lines (positive = credit to the wallet, negative = debit)
 * that must sum to zero per currency. Postings run inside the caller's database
 * transaction so the ledger lines, the cached balances and the transaction status
 * commit or roll back together.
 */

export interface LedgerLine {
  walletId: string;
  amount: bigint;
  entryType: LedgerEntryType;
}

interface LockedWallet {
  id: string;
  currencyCode: string;
  balance: bigint;
  status: WalletStatus;
  allowNegative: boolean;
}

export interface PostingResult {
  /** Balance of every touched wallet after the posting. */
  balances: Map<string, bigint>;
}

/** Pure validation of a posting's shape (exported for unit tests). */
export function assertBalancedLines(lines: LedgerLine[], currencyOf: (walletId: string) => string): void {
  if (lines.length < 2) {
    throw new LedgerInvariantError('A posting needs at least two lines');
  }
  const totals = new Map<string, bigint>();
  for (const line of lines) {
    if (line.amount === 0n) throw new LedgerInvariantError('Ledger lines cannot be zero', { line });
    const currency = currencyOf(line.walletId);
    totals.set(currency, (totals.get(currency) ?? 0n) + line.amount);
  }
  for (const [currency, total] of totals) {
    if (total !== 0n) {
      throw new LedgerInvariantError(`Posting is unbalanced in ${currency} by ${total}`, {
        currency,
        total: total.toString(),
      });
    }
  }
}

export async function postLedgerLines(
  tx: Prisma.TransactionClient,
  transactionId: string,
  lines: LedgerLine[],
): Promise<PostingResult> {
  const walletIds = [...new Set(lines.map((l) => l.walletId))].sort();

  // Lock every touched wallet row, always in the same (id) order, so two concurrent
  // payments between the same wallets queue up instead of deadlocking or double-spending.
  const locked = await tx.$queryRaw<LockedWallet[]>`
    SELECT id::text            AS "id",
           currency_code       AS "currencyCode",
           balance             AS "balance",
           status::text        AS "status",
           allow_negative      AS "allowNegative"
    FROM wallets
    WHERE id = ANY(${walletIds}::uuid[])
    ORDER BY id
    FOR UPDATE`;

  const wallets = new Map(locked.map((w) => [w.id, w]));
  for (const id of walletIds) {
    if (!wallets.has(id)) throw new LedgerInvariantError(`Wallet ${id} does not exist`);
  }

  // Lines for different currencies in one posting are fine (FX), but each currency must net to zero.
  if (new Set(locked.map((w) => w.currencyCode)).size > 1 && !lines.some((l) => l.entryType === 'FX')) {
    throw new PaymentRejectedError('CURRENCY_MISMATCH', 'Wallets are in different currencies');
  }
  assertBalancedLines(lines, (id) => wallets.get(id)!.currencyCode);

  for (const w of locked) {
    if (w.status !== 'ACTIVE') {
      throw new PaymentRejectedError('WALLET_NOT_ACTIVE', 'A wallet in this payment is not active', {
        walletId: w.id,
        status: w.status,
      });
    }
  }

  // Apply lines in order, tracking the running balance for balanceAfter.
  const running = new Map(locked.map((w) => [w.id, w.balance]));
  const entries: Prisma.LedgerEntryCreateManyInput[] = lines.map((line) => {
    const next = running.get(line.walletId)! + line.amount;
    running.set(line.walletId, next);
    return {
      transactionId,
      walletId: line.walletId,
      entryType: line.entryType,
      amount: line.amount,
      currencyCode: wallets.get(line.walletId)!.currencyCode,
      balanceAfter: next,
    };
  });

  for (const [id, balance] of running) {
    if (balance < 0n && !wallets.get(id)!.allowNegative) {
      throw new PaymentRejectedError('INSUFFICIENT_FUNDS', 'Insufficient balance', { walletId: id });
    }
  }

  await tx.ledgerEntry.createMany({ data: entries });
  for (const [id, balance] of running) {
    await tx.wallet.update({ where: { id }, data: { balance, version: { increment: 1 } } });
  }

  return { balances: running };
}

export interface ReconciliationReport {
  ok: boolean;
  /** Wallets whose cached balance differs from the sum of their ledger entries. */
  walletMismatches: { walletId: string; cachedBalance: bigint; ledgerBalance: bigint }[];
  /** Currencies whose ledger does not net to zero across all wallets (should be impossible). */
  currencyImbalances: { currencyCode: string; total: bigint }[];
  /** Transactions whose own lines do not net to zero. */
  unbalancedTransactions: { transactionId: string; currencyCode: string; total: bigint }[];
}

/** Verifies the ledger's invariants. Run on a schedule and before any real settlement. */
export async function reconcileLedger(db: Prisma.TransactionClient): Promise<ReconciliationReport> {
  const walletMismatches = await db.$queryRaw<ReconciliationReport['walletMismatches']>`
    SELECT w.id::text AS "walletId", w.balance AS "cachedBalance",
           COALESCE(SUM(e.amount), 0)::bigint AS "ledgerBalance"
    FROM wallets w
    LEFT JOIN ledger_entries e ON e.wallet_id = w.id
    GROUP BY w.id
    HAVING w.balance <> COALESCE(SUM(e.amount), 0)`;

  const currencyImbalances = await db.$queryRaw<ReconciliationReport['currencyImbalances']>`
    SELECT currency_code AS "currencyCode", SUM(amount)::bigint AS "total"
    FROM ledger_entries
    GROUP BY currency_code
    HAVING SUM(amount) <> 0`;

  const unbalancedTransactions = await db.$queryRaw<ReconciliationReport['unbalancedTransactions']>`
    SELECT transaction_id::text AS "transactionId", currency_code AS "currencyCode",
           SUM(amount)::bigint AS "total"
    FROM ledger_entries
    GROUP BY transaction_id, currency_code
    HAVING SUM(amount) <> 0`;

  return {
    ok: !walletMismatches.length && !currencyImbalances.length && !unbalancedTransactions.length,
    walletMismatches,
    currencyImbalances,
    unbalancedTransactions,
  };
}
