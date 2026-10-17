import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, Party, Txn } from '../lib/api';
import { useAuth } from '../lib/auth';
import { humanize, money, when } from '../lib/format';
import { Badge, ErrorBox, Loading, PageHead, ReasonModal, toast, useApi } from '../components/ui';

interface TxnDetail extends Txn {
  providerReference: string | null;
  idempotencyKey: string | null;
  reverses: { id: string; reference: string } | null;
  reversedBy: { id: string; reference: string; createdAt: string; description: string | null } | null;
  events: { id: string; from: string | null; to: string; actorType: string; note: string | null; at: string }[];
  ledger: { id: string; account: Party | null; entryType: string; amount: string; balanceAfter: string }[];
  cases: { id: string; reference: string; subject: string; status: string }[];
  approvals: { id: string; status: string; reason: string; requestedBy: string; decidedBy: string | null; decisionNote: string | null; createdAt: string }[];
}

export function TransactionDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: t, error, loading, reload } = useApi(() => api<TxnDetail>(`/transactions/${id}`), [id]);
  const [requesting, setRequesting] = useState(false);

  if (error != null) return <ErrorBox error={error} />;
  if (loading && !t) return <div className="card"><Loading rows={8} /></div>;
  if (!t) return null;

  const pendingApproval = t.approvals.some((a) => a.status === 'PENDING');
  const reversible = t.status === 'SUCCESS' && t.type !== 'REVERSAL' && !t.reversedBy && !pendingApproval;

  return (
    <>
      <PageHead
        title={t.reference}
        subtitle={<>{humanize(t.type)} · {money(t.amount, t.currency)} · <Badge value={t.status} /></>}
        actions={
          can('approvals:request') && reversible ? (
            <button className="btn danger" onClick={() => setRequesting(true)}>Request reversal</button>
          ) : pendingApproval ? <span className="badge warn">Reversal awaiting approval</span> : null
        }
      />

      <div className="grid cols-main">
        <div className="grid">
          <div className="card card-pad">
            <dl className="kv">
              <dt>From</dt><dd><PartyLink party={t.from} /></dd>
              <dt>To</dt><dd><PartyLink party={t.to} /></dd>
              <dt>Amount</dt><dd>{money(t.amount, t.currency)}</dd>
              <dt>Fee</dt><dd>{money(t.fee, t.currency)}</dd>
              <dt>Description</dt><dd>{t.description ?? '—'}</dd>
              {t.failureCode && (<><dt>Failure</dt><dd><span className="badge bad">{humanize(t.failureCode)}</span> {t.failureReason}</dd></>)}
              <dt>Created</dt><dd>{when(t.createdAt)}</dd>
              <dt>Completed</dt><dd>{when(t.completedAt)}</dd>
              <dt>Rail</dt><dd>{t.providerName ?? 'Internal (SurePesa ledger)'}{t.providerReference && <div className="mono muted">{t.providerReference}</div>}</dd>
              {t.reverses && (<><dt>Reverses</dt><dd><Link to={`/transactions/${t.reverses.id}`} className="mono">{t.reverses.reference}</Link></dd></>)}
              {t.reversedBy && (<><dt>Reversed by</dt><dd><Link to={`/transactions/${t.reversedBy.id}`} className="mono">{t.reversedBy.reference}</Link> · {when(t.reversedBy.createdAt)}</dd></>)}
            </dl>
          </div>

          <div className="card">
            <div className="card-head"><h2>Ledger postings</h2><span className="muted">Debits and credits always net to zero</span></div>
            {t.ledger.length === 0 ? <div className="empty">No money moved for this transaction.</div> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Account</th><th>Entry</th><th className="num">Amount</th><th className="num">Balance after</th></tr></thead>
                  <tbody>
                    {t.ledger.map((e) => (
                      <tr key={e.id}>
                        <td>{e.account?.name}<div className="muted mono">{e.account?.detail}</div></td>
                        <td>{humanize(e.entryType)}</td>
                        <td className="num">{money(e.amount, t.currency)}</td>
                        <td className="num muted">{money(e.balanceAfter, t.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <div className="card-head"><h2>Status history</h2></div>
            <div className="card-pad">
              <ul className="timeline">
                {t.events.map((e) => (
                  <li key={e.id}>
                    <Badge value={e.to} /> <span className="muted">by {humanize(e.actorType)}</span>
                    <div className="muted" style={{ fontSize: 12 }}>{when(e.at)}</div>
                    {e.note && <div style={{ fontSize: 13 }}>{e.note}</div>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {(t.approvals.length > 0 || t.cases.length > 0) && (
            <div className="card">
              <div className="card-head"><h2>Cases & approvals</h2></div>
              <div className="card-pad grid" style={{ gap: 10 }}>
                {t.cases.map((c) => (
                  <Link key={c.id} to={`/cases/${c.id}`} className="note" style={{ color: 'inherit' }}>
                    <div className="note-meta mono">{c.reference}</div>{c.subject} <Badge value={c.status} />
                  </Link>
                ))}
                {t.approvals.map((a) => (
                  <div key={a.id} className="note">
                    <div className="note-meta">Reversal request · {when(a.createdAt)} · by {a.requestedBy}</div>
                    <Badge value={a.status} /> {a.reason}
                    {a.decidedBy && <div className="muted" style={{ marginTop: 4 }}>Decided by {a.decidedBy}{a.decisionNote ? `: ${a.decisionNote}` : ''}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {requesting && (
        <ReasonModal
          title={`Request reversal of ${t.reference}`}
          description={<>This sends a request to Finance. Money moves only after <strong>another</strong> authorised person approves it.</>}
          label="Reason (shown to the approver)"
          confirmLabel="Send for approval"
          minLength={10}
          onConfirm={async (reason) => {
            await api('/approvals', { method: 'POST', body: { transactionId: t.id, reason } });
            toast('Reversal request sent for approval.');
            reload();
          }}
          onClose={() => setRequesting(false)}
        />
      )}
    </>
  );
}

function PartyLink({ party }: { party: Party | null }) {
  if (!party) return <>—</>;
  const body = <>{party.name}{party.detail && <span className="muted"> · {party.detail}</span>}</>;
  return party.kind === 'USER' && party.id ? <Link to={`/customers/${party.id}`}>{body}</Link> : body;
}
