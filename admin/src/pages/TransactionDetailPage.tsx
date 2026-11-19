import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, Party, Txn } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fromMinor, humanize, money, toMinor, when } from '../lib/format';
import { Badge, ErrorBox, Loading, PageHead, ReasonModal, toast, useApi } from '../components/ui';

interface TxnDetail extends Txn {
  providerReference: string | null;
  idempotencyKey: string | null;
  reverses: { id: string; reference: string } | null;
  reversedBy: { id: string; reference: string; createdAt: string; description: string | null } | null;
  events: { id: string; from: string | null; to: string; actorType: string; note: string | null; at: string }[];
  ledger: { id: string; account: Party | null; entryType: string; amount: string; balanceAfter: string }[];
  cases: { id: string; reference: string; subject: string; status: string }[];
  approvals: { id: string; type: string; status: string; reason: string; requestedBy: string; decidedBy: string | null; decisionNote: string | null; createdAt: string }[];
}

export function TransactionDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: t, error, loading, reload } = useApi(() => api<TxnDetail>(`/transactions/${id}`), [id]);
  const [requesting, setRequesting] = useState(false);
  const [refunding, setRefunding] = useState(false);

  if (error != null) return <ErrorBox error={error} />;
  if (loading && !t) return <div className="card"><Loading rows={8} /></div>;
  if (!t) return null;

  const pendingApproval = t.approvals.some((a) => a.status === 'PENDING');
  const reversible = t.status === 'SUCCESS' && t.type !== 'REVERSAL' && t.type !== 'REFUND' && !t.reversedBy && !pendingApproval;
  // Merchant payments can also be refunded in part; the server checks what is left to refund.
  const refundable = t.status === 'SUCCESS' && t.type === 'MERCHANT_PAYMENT' && !t.reversedBy && !pendingApproval;
  const pendingType = t.approvals.find((a) => a.status === 'PENDING')?.type;

  return (
    <>
      <PageHead
        title={t.reference}
        subtitle={<>{humanize(t.type)} · {money(t.amount, t.currency)} · <Badge value={t.status} /></>}
        actions={
          can('approvals:request') && (reversible || refundable) ? (
            <>
              {refundable && <button className="btn" onClick={() => setRefunding(true)}>Request refund</button>}
              {reversible && <button className="btn danger" onClick={() => setRequesting(true)}>Request reversal</button>}
            </>
          ) : pendingApproval ? <span className="badge warn">{pendingType === 'TRANSACTION_REFUND' ? 'Refund' : 'Reversal'} awaiting approval</span> : null
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
                    <div className="note-meta">{a.type === 'TRANSACTION_REFUND' ? 'Refund' : 'Reversal'} request · {when(a.createdAt)} · by {a.requestedBy}</div>
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
      {refunding && <RefundModal txn={t} onDone={reload} onClose={() => setRefunding(false)} />}
    </>
  );
}

/** Refund all or part of a merchant payment: amount in TZS, sent as minor units, plus a reason. */
function RefundModal({ txn, onDone, onClose }: { txn: TxnDetail; onDone: () => void; onClose: () => void }) {
  const [amount, setAmount] = useState(txn.amount);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const minor = toMinor(amount);
  const max = toMinor(txn.amount);
  const tooBig = minor !== null && max !== null && BigInt(minor) > BigInt(max);
  const valid = minor !== null && minor !== '0' && !tooBig && reason.trim().length >= 10;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api('/approvals', { method: 'POST', body: { type: 'TRANSACTION_REFUND', transactionId: txn.id, amount: minor, reason: reason.trim() } });
      toast(`Refund of ${fromMinor(minor, txn.currency)} sent for approval.`);
      onDone();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Request refund of ${txn.reference}`} onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Request refund of {txn.reference}</h2>
        <div className="muted">
          Returns money from {txn.to?.name ?? 'the merchant'} to {txn.from?.name ?? 'the payer'}. You can refund part of the payment; all refunds together can never exceed {money(txn.amount, txn.currency)}. The fee is not returned. Money moves only after <strong>another</strong> authorised person approves it.
        </div>
        <label className="field">
          Amount to refund ({txn.currency})
          <input className="input" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
          {minor === null || minor === '0' ? (
            <span style={{ color: 'var(--bad)', fontWeight: 400 }}>Enter an amount above zero, like 5,000</span>
          ) : tooBig ? (
            <span style={{ color: 'var(--bad)', fontWeight: 400 }}>More than the payment of {money(txn.amount, txn.currency)}</span>
          ) : (
            <span className="muted" style={{ fontWeight: 400 }}>{fromMinor(minor, txn.currency)}{minor === max ? ' (full amount)' : ' (partial)'}</span>
          )}
        </label>
        <label className="field">
          Reason (shown to the approver)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error != null && <ErrorBox error={error} />}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" disabled={busy || !valid} onClick={submit}>{busy ? 'Working…' : 'Send for approval'}</button>
        </div>
      </div>
    </div>
  );
}

function PartyLink({ party }: { party: Party | null }) {
  if (!party) return <>—</>;
  const body = <>{party.name}{party.detail && <span className="muted"> · {party.detail}</span>}</>;
  return party.kind === 'USER' && party.id ? <Link to={`/customers/${party.id}`}>{body}</Link> : body;
}
