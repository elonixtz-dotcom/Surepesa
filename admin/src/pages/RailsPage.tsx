import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Page, Txn } from '../lib/api';
import { ago, humanize, money, when } from '../lib/format';
import { Badge, Empty, ErrorBox, Loading, PageHead, Pager, PartyCell, toast, useApi } from '../components/ui';

interface OpenRail extends Txn {
  rail: {
    provider: string | null;
    providerReference: string | null;
    lastStatus: string | null;
    checks: number;
    nextCheckAt: string | null;
    escalatedAt: string | null;
    escalationReason: string | null;
  };
}

interface ProviderEvent {
  id: string;
  providerName: string;
  eventId: string;
  status: string;
  payload: unknown;
  outcome: string | null;
  receivedAt: string;
  processedAt: string | null;
}

const OUTCOME_TEXT: Record<string, string> = {
  APPLIED: 'The rail gave a final answer and it was applied.',
  NOT_FINAL: 'The rail still has no final answer. Funds stay held.',
  ESCALATED: 'Still unanswered after the retry window. Escalated to Finance.',
  ALREADY_FINAL: 'Already settled: the rail answered before this check.',
};

/**
 * Finance view of deposits and withdrawals the rails have not settled. Funds stay held while
 * a transaction is here. Escalated ones need a person: check the provider's portal, then
 * "Check now" or raise a reversal from the transaction.
 */
export function RailsPage() {
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi(
    () => api<Page<OpenRail> & { escalated: number }>(`/rails/open?page=${page}${escalatedOnly ? '&escalated=true' : ''}`),
    [page, escalatedOnly],
  );
  const [checking, setChecking] = useState<string | null>(null);
  const [eventsFor, setEventsFor] = useState<OpenRail | null>(null);

  async function checkNow(t: OpenRail) {
    setChecking(t.id);
    try {
      const res = await api<{ outcome: string }>(`/rails/${t.id}/check`, { method: 'POST' });
      toast(`${t.reference}: ${OUTCOME_TEXT[res.outcome] ?? humanize(res.outcome)}`);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Check failed', 'bad');
    } finally {
      setChecking(null);
    }
  }

  return (
    <>
      <PageHead
        title="Unsettled rails"
        subtitle="Deposits and withdrawals the mobile-money rails haven't confirmed. Funds stay held; the system re-checks every few minutes and escalates when the rail stays silent."
        actions={
          <div className="toolbar" role="tablist">
            {([false, true] as const).map((v) => (
              <button
                key={String(v)}
                role="tab"
                aria-selected={escalatedOnly === v}
                className={`btn sm${escalatedOnly === v ? ' primary' : ''}`}
                onClick={() => { setEscalatedOnly(v); setPage(1); }}
              >
                {v ? `Escalated${data ? ` (${data.escalated})` : ''}` : 'All open'}
              </button>
            ))}
            <button className="btn sm" onClick={reload} disabled={loading}>Refresh</button>
          </div>
        }
      />
      {data && data.escalated > 0 && !escalatedOnly && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          {data.escalated} {data.escalated === 1 ? 'transaction needs' : 'transactions need'} a person. Confirm the outcome on the provider's portal or statement, then check again.
        </div>
      )}
      {error != null && <ErrorBox error={error} />}
      <div className="card">
        {loading && !data && <Loading />}
        {data && data.items.length === 0 && <Empty>{escalatedOnly ? 'Nothing escalated.' : 'Every deposit and withdrawal is settled.'}</Empty>}
        {data && data.items.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Customer</th>
                  <th className="num">Amount</th>
                  <th>Rail</th>
                  <th>Last rail status</th>
                  <th className="num">Checks</th>
                  <th>Next check</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => (
                  <tr key={t.id} className={t.rail.escalatedAt ? 'escalated' : ''}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Link to={`/transactions/${t.id}`} className="mono">{t.reference}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>{humanize(t.type)} · {ago(t.createdAt)}</div>
                    </td>
                    <td><PartyCell party={t.type === 'DEPOSIT' ? t.to : t.from} /></td>
                    <td className="num">{money(t.amount, t.currency)}</td>
                    <td>
                      {t.rail.provider ?? '—'}
                      <div className="mono muted">{t.rail.providerReference ?? 'no provider reference'}</div>
                    </td>
                    <td>
                      {t.rail.lastStatus ? <Badge value={t.rail.lastStatus} /> : <span className="muted">—</span>}
                      {t.rail.escalatedAt && (
                        <div style={{ marginTop: 4, fontSize: 12.5 }}>
                          <span className="badge bad">Escalated {ago(t.rail.escalatedAt)}</span>
                          {t.rail.escalationReason && <div className="muted" style={{ marginTop: 2 }}>{t.rail.escalationReason}</div>}
                        </div>
                      )}
                    </td>
                    <td className="num">{t.rail.checks}</td>
                    <td className="muted">{t.rail.escalatedAt ? 'Stopped, needs a person' : when(t.rail.nextCheckAt)}</td>
                    <td>
                      <div className="toolbar" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn sm primary" disabled={checking === t.id} onClick={() => checkNow(t)}>
                          {checking === t.id ? 'Checking…' : 'Check now'}
                        </button>
                        <button className="btn sm" onClick={() => setEventsFor(t)}>Callbacks</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </div>
      {eventsFor && <EventsDrawer txn={eventsFor} onClose={() => setEventsFor(null)} />}
    </>
  );
}

function EventsDrawer({ txn, onClose }: { txn: OpenRail; onClose: () => void }) {
  const { data, error, loading } = useApi(() => api<{ items: ProviderEvent[] }>(`/rails/${txn.id}/events`), [txn.id]);
  return (
    <div className="drawer-backdrop" role="dialog" aria-modal="true" aria-label={`Provider callbacks for ${txn.reference}`} onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <h2>Provider callbacks</h2>
            <div className="muted"><span className="mono">{txn.reference}</span> · {txn.rail.provider ?? 'unknown rail'}</div>
          </div>
          <button className="btn sm" onClick={onClose} aria-label="Close">Close</button>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>Verified callbacks exactly as the rail sent them, oldest first. Use these for disputes and reconciliation.</div>
        {error != null && <ErrorBox error={error} />}
        {loading && !data && <Loading />}
        {data && data.items.length === 0 && <Empty>The rail hasn't sent any callbacks for this transaction.</Empty>}
        {data?.items.map((e) => (
          <div key={e.id} className="note">
            <div className="note-meta">{when(e.receivedAt)} · event <span className="mono">{e.eventId}</span></div>
            <Badge value={e.status} /> {e.outcome && <span className="muted">→ {humanize(e.outcome)}</span>}
            {!e.processedAt && <span className="badge warn" style={{ marginLeft: 6 }}>Not processed</span>}
            <pre>{JSON.stringify(e.payload, null, 2)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
