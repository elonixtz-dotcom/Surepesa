import { api, Txn } from '../lib/api';
import { when } from '../lib/format';
import { ErrorBox, Loading, PageHead, Stat, TxnTable, useApi } from '../components/ui';

interface SystemStatus {
  services: Record<string, { status: string; latencyMs: number }>;
  reconciliation: {
    ok: boolean;
    checkedAt: string;
    ledgerEntries: number;
    wallets: number;
    walletMismatches: number;
    currencyImbalances: number;
    unbalancedTransactions: number;
  };
  stuckTransactions: Txn[];
}

const SERVICE_NAMES: Record<string, string> = {
  database: 'Database (Neon Postgres)',
  auth: 'Customer sign-in (Neon Auth)',
  storage: 'Document storage',
  paymentRails: 'Payment rails',
};

export function SystemPage() {
  const { data, error, loading, reload } = useApi(() => api<SystemStatus>('/system'), []);

  return (
    <>
      <PageHead
        title="System health"
        subtitle="Dependencies, ledger reconciliation and stuck payments."
        actions={<button className="btn" onClick={reload} disabled={loading}>{loading ? 'Checking…' : 'Run checks'}</button>}
      />
      {error != null && <ErrorBox error={error} />}
      {loading && !data && <div className="card"><Loading rows={6} /></div>}
      {data && (
        <div className="grid">
          <div className="grid cols-4">
            {Object.entries(data.services).map(([key, s]) => (
              <div key={key} className="card stat">
                <div className="stat-label">{SERVICE_NAMES[key] ?? key}</div>
                <div style={{ marginTop: 8 }}>
                  <span className={`badge ${s.status === 'ok' ? 'good' : s.status === 'simulated' ? 'info' : 'bad'}`}>
                    {s.status === 'ok' ? 'Operational' : s.status === 'simulated' ? 'Simulated' : 'Down'}
                  </span>
                </div>
                <div className="stat-sub">{s.status === 'simulated' ? 'No live provider connected yet' : `${s.latencyMs} ms`}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Ledger reconciliation</h2>
              <span className={`badge ${data.reconciliation.ok ? 'good' : 'bad'}`}>{data.reconciliation.ok ? 'Balanced' : 'Mismatch: escalate (P1)'}</span>
            </div>
            <div className="card-pad grid cols-4">
              <Stat label="Wallet balance mismatches" value={data.reconciliation.walletMismatches} sub="Cached balance vs ledger sum" />
              <Stat label="Currency imbalances" value={data.reconciliation.currencyImbalances} sub="Ledger must net to zero" />
              <Stat label="Unbalanced transactions" value={data.reconciliation.unbalancedTransactions} sub="Per-transaction postings" />
              <Stat label="Ledger entries checked" value={data.reconciliation.ledgerEntries.toLocaleString()} sub={`${data.reconciliation.wallets} wallets · ${when(data.reconciliation.checkedAt)}`} />
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Payments stuck in processing</h2><span className="muted">Older than 15 minutes</span></div>
            <TxnTable items={data.stuckTransactions} />
          </div>
        </div>
      )}
    </>
  );
}
