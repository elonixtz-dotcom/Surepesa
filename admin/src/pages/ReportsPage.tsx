import { useState } from 'react';
import { api, ApiError, getToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { humanize, money } from '../lib/format';
import { FlowChart, FlowPoint } from '../components/BarChart';
import { Empty, ErrorBox, Loading, PageHead, Stat, toast, useApi } from '../components/ui';

interface Movement {
  range: { from: string; to: string; days: number; timeZone: string; currency: string };
  totals: {
    moneyIn: string; moneyOut: string; netFlow: string; internal: string; fees: string;
    transactions: number; failed: number; failureRate: number | null;
  };
  daily: (FlowPoint & { internal: string; fees: string })[];
  byType: { type: string; count: number; completed: number; failed: number; pending: number; volume: string; fees: string }[];
  byRail: { rail: string; type: string; count: number; completed: number; failed: number; volume: string }[];
}

const PRESETS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

/** Calendar date in East Africa Time, YYYY-MM-DD. */
const eatDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).format(d);
const daysAgo = (n: number) => eatDate(new Date(Date.now() - n * 86_400_000));

/** Money movement: what came in, what went out, through which rails, and what it earned. */
export function ReportsPage() {
  const { can } = useAuth();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [exporting, setExporting] = useState(false);
  const query = `from=${from}&to=${to}`;
  const { data, error, loading, reload } = useApi(() => api<Movement>(`/reports/movement?${query}`), [query]);

  const preset = PRESETS.find((p) => from === daysAgo(p.days - 1) && to === daysAgo(0))?.days;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/admin/v1/reports/movement.csv?${query}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, body?.error?.code ?? `HTTP_${res.status}`, body?.error?.message ?? 'Export failed');
      }
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `surepesa-movement-${from}-to-${to}.csv` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast('Export downloaded. It is recorded in the audit log.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', 'bad');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHead
        title="Reports"
        subtitle="Money movement in TZS, by day, type and rail. Days are East Africa Time."
        actions={
          <>
            <button className="btn" onClick={reload}>Refresh</button>
            {can('reports:export') && (
              <button className="btn primary" onClick={exportCsv} disabled={exporting}>
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
            )}
          </>
        }
      />

      <div className="card card-pad toolbar" style={{ marginBottom: 16 }}>
        <div className="seg" role="group" aria-label="Period">
          {PRESETS.map((p) => (
            <button
              key={p.days}
              aria-pressed={preset === p.days}
              onClick={() => {
                setFrom(daysAgo(p.days - 1));
                setTo(daysAgo(0));
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="muted">From <input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
        <label className="muted">To <input className="input" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} style={{ width: 'auto' }} /></label>
      </div>

      {error != null && <ErrorBox error={error} />}
      {loading && !data && <div className="card"><Loading rows={6} /></div>}
      {data && (
        <div className="grid">
          <div className="grid cols-4">
            <Stat label="Money in" value={money(data.totals.moneyIn)} sub="Completed deposits" />
            <Stat label="Money out" value={money(data.totals.moneyOut)} sub="Completed withdrawals" />
            <Stat label="Net flow" value={money(data.totals.netFlow)} sub={`Inside SurePesa: ${money(data.totals.internal)}`} />
            <Stat
              label="Fees earned"
              value={money(data.totals.fees)}
              sub={`${data.totals.transactions.toLocaleString()} transactions · ${data.totals.failureRate == null ? '—' : `${data.totals.failureRate}%`} failed`}
            />
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Money in and out per day</h2>
              <span className="muted">{data.range.days} days</span>
            </div>
            <div className="card-pad"><FlowChart data={data.daily} /></div>
          </div>

          <div className="card">
            <div className="card-head"><h2>By transaction type</h2><span className="muted">Volume counts completed payments only</span></div>
            {data.byType.length === 0 ? <Empty>No transactions in this period.</Empty> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Type</th><th className="num">Transactions</th><th className="num">Completed</th><th className="num">Failed</th><th className="num">In progress</th><th className="num">Volume</th><th className="num">Fees</th></tr>
                  </thead>
                  <tbody>
                    {data.byType.map((t) => (
                      <tr key={t.type}>
                        <td>{humanize(t.type)}</td>
                        <td className="num">{t.count.toLocaleString()}</td>
                        <td className="num">{t.completed.toLocaleString()}</td>
                        <td className="num">{t.failed ? <span className="badge bad">{t.failed}</span> : 0}</td>
                        <td className="num">{t.pending ? <span className="badge warn">{t.pending}</span> : 0}</td>
                        <td className="num">{money(t.volume)}</td>
                        <td className="num">{money(t.fees)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head"><h2>By rail</h2><span className="muted">Deposits and withdrawals through mobile money and banks</span></div>
            {data.byRail.length === 0 ? <Empty>No deposits or withdrawals in this period.</Empty> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Rail</th><th>Direction</th><th className="num">Transactions</th><th className="num">Success rate</th><th className="num">Failed</th><th className="num">Volume</th></tr>
                  </thead>
                  <tbody>
                    {data.byRail.map((r) => {
                      const settled = r.completed + r.failed;
                      return (
                        <tr key={`${r.rail}-${r.type}`}>
                          <td className="mono">{r.rail}</td>
                          <td>{r.type === 'DEPOSIT' ? 'Money in' : 'Money out'}</td>
                          <td className="num">{r.count.toLocaleString()}</td>
                          <td className="num">{settled ? `${Math.round((r.completed / settled) * 1000) / 10}%` : '—'}</td>
                          <td className="num">{r.failed}</td>
                          <td className="num">{money(r.volume)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
