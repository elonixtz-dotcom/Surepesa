import { Link } from 'react-router-dom';
import { api, Txn } from '../lib/api';
import { money } from '../lib/format';
import { VolumeChart, DayPoint } from '../components/BarChart';
import { ErrorBox, Loading, PageHead, Stat, TxnTable, useApi } from '../components/ui';

interface Overview {
  customers: { total: number; active: number; suspended: number; businesses: number };
  today: { transactions: number; successful: number; failed: number; processing: number; volume: string; successRate: number | null };
  last30Days: { transactions: number; volume: string };
  queues: { pendingKyc: number; openCases: number; pendingApprovals: number; stuckProcessing: number };
  daily: DayPoint[];
  recentFailed: Txn[];
}

/** System Controller home: health of the business at a glance and the queues that need a human. */
export function OverviewPage() {
  const { data, error, loading, reload } = useApi(() => api<Overview>('/overview'), []);

  return (
    <>
      <PageHead
        title="Overview"
        subtitle="Live view of customers, payments and work queues."
        actions={<button className="btn" onClick={reload}>Refresh</button>}
      />
      {error != null && <ErrorBox error={error} />}
      {loading && !data && <div className="card"><Loading rows={6} /></div>}
      {data && (
        <div className="grid">
          <div className="grid cols-4">
            <Stat label="Volume today" value={money(data.today.volume)} sub={`${data.today.transactions} transactions`} />
            <Stat
              label="Success rate today"
              value={data.today.successRate == null ? '—' : `${data.today.successRate}%`}
              sub={`${data.today.successful} succeeded · ${data.today.failed} failed`}
            />
            <Stat label="Volume, last 30 days" value={money(data.last30Days.volume)} sub={`${data.last30Days.transactions.toLocaleString()} successful`} />
            <Stat label="Customers" value={data.customers.total.toLocaleString()} sub={`${data.customers.active} active · ${data.customers.suspended} suspended`} />
          </div>

          <div className="grid cols-main">
            <div className="card">
              <div className="card-head">
                <h2>Settled volume per day (TZS)</h2>
                <span className="muted">Last 14 days</span>
              </div>
              <div className="card-pad"><VolumeChart data={data.daily} /></div>
            </div>
            <div className="card">
              <div className="card-head"><h2>Needs attention</h2></div>
              <div className="card-pad grid" style={{ gap: 10 }}>
                <Queue to="/approvals" label="Reversal approvals pending" value={data.queues.pendingApprovals} />
                <Queue to="/kyc" label="KYC submissions waiting" value={data.queues.pendingKyc} />
                <Queue to="/cases" label="Open support cases" value={data.queues.openCases} />
                <Queue to="/system" label="Payments stuck in processing (>15 min)" value={data.queues.stuckProcessing} critical />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Recent failed payments</h2>
              <Link to="/transactions?status=FAILED">View all</Link>
            </div>
            <TxnTable items={data.recentFailed} />
          </div>
        </div>
      )}
    </>
  );
}

function Queue({ to, label, value, critical }: { to: string; label: string; value: number; critical?: boolean }) {
  const tone = value === 0 ? 'good' : critical ? 'bad' : 'warn';
  return (
    <Link to={to} className="note" style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'inherit', textDecoration: 'none' }}>
      <span style={{ flex: 1, fontWeight: 600 }}>{label}</span>
      <span className={`badge ${tone}`}>{value === 0 ? 'Clear' : value}</span>
    </Link>
  );
}
