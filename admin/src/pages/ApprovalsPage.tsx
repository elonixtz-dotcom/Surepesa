import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Approval, Page } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago, fromMinor, money, when } from '../lib/format';
import { Badge, Empty, ErrorBox, Loading, PageHead, ReasonModal, toast, useApi } from '../components/ui';

type Decision = { approval: Approval; action: 'approve' | 'reject' };

const isRefund = (a: Approval) => a.type === 'TRANSACTION_REFUND';
const kind = (a: Approval) => (isRefund(a) ? 'refund' : 'reversal');
/** A refund moves its own (possibly partial) amount; a reversal returns the whole transaction. */
const amountOf = (a: Approval) =>
  isRefund(a) ? fromMinor(a.amount, a.transaction?.currency) : money(a.transaction?.amount, a.transaction?.currency);

/**
 * Maker-checker queue. Approvers see who asked and why, then approve (money moves back) or
 * reject. The server refuses decisions on your own requests; the UI explains that upfront.
 */
export function ApprovalsPage() {
  const { staff, can } = useAuth();
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const { data, error, loading, reload } = useApi(() => api<Page<Approval>>(`/approvals?status=${status}`), [status]);
  const [decision, setDecision] = useState<Decision | null>(null);

  return (
    <>
      <PageHead
        title="Approvals"
        subtitle="Reversal and refund requests need a second person's approval. You can't decide your own."
        actions={
          <div className="toolbar" role="tablist">
            {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
              <button key={s} role="tab" aria-selected={status === s} className={`btn sm${status === s ? ' primary' : ''}`} onClick={() => setStatus(s)}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        }
      />
      {error != null && <ErrorBox error={error} />}
      {loading && !data && <div className="card"><Loading /></div>}
      {data && data.items.length === 0 && <div className="card"><Empty>No {status.toLowerCase()} requests.</Empty></div>}
      <div className="grid">
        {data?.items.map((a) => {
          const own = a.requestedBy.id === staff!.id;
          return (
            <div key={a.id} className="card card-pad grid" style={{ gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    <span className={`badge ${isRefund(a) ? 'info' : ''}`}>{isRefund(a) ? 'Refund' : 'Reversal'}</span>
                    {' '}{ago(a.createdAt)} · by {a.requestedBy.fullName}
                  </div>
                  <h2 style={{ marginTop: 4 }}>
                    {a.transaction ? <Link to={`/transactions/${a.transaction.id}`} className="mono">{a.transaction.reference}</Link> : '—'}
                    {' · '}{amountOf(a)}
                  </h2>
                  {isRefund(a) && a.transaction && (
                    <div className="muted">
                      {fromMinor(a.amount) === money(a.transaction.amount) ? 'Full' : 'Partial'} refund of a {money(a.transaction.amount, a.transaction.currency)} payment
                    </div>
                  )}
                  {a.transaction && (
                    <div className="muted" style={{ marginTop: 2 }}>
                      {a.transaction.from?.name} → {a.transaction.to?.name} · {when(a.transaction.createdAt)}
                    </div>
                  )}
                </div>
                <Badge value={a.status} />
              </div>
              <div className="note"><div className="note-meta">Reason</div>{a.reason}</div>
              {a.case && <div className="muted">Linked case <Link to={`/cases/${a.case.id}`} className="mono">{a.case.reference}</Link> · {a.case.subject}</div>}
              {a.decidedBy && (
                <div className="muted">Decided by <strong>{a.decidedBy.fullName}</strong> {when(a.decidedAt)}{a.decisionNote ? ` · “${a.decisionNote}”` : ''}</div>
              )}
              {a.status === 'PENDING' && can('approvals:decide') && (
                own ? (
                  <div className="alert warn">You raised this request, so another approver must decide it.</div>
                ) : (
                  <div className="toolbar">
                    <button className="btn primary" onClick={() => setDecision({ approval: a, action: 'approve' })}>Approve {kind(a)}</button>
                    <button className="btn danger" onClick={() => setDecision({ approval: a, action: 'reject' })}>Reject</button>
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>

      {decision && (
        <ReasonModal
          title={decision.action === 'approve' ? `Approve ${kind(decision.approval)}` : `Reject ${kind(decision.approval)} request`}
          description={
            decision.action === 'approve'
              ? <>This returns <strong>{amountOf(decision.approval)}</strong> to {decision.approval.transaction?.from?.name}. If the recipient has already spent the money, the {kind(decision.approval)} will be refused and the request stays pending.</>
              : 'The requester will see your reason on the case.'
          }
          label={decision.action === 'approve' ? 'Note (optional)' : 'Reason for rejection'}
          confirmLabel={decision.action === 'approve' ? (isRefund(decision.approval) ? 'Approve and refund' : 'Approve and reverse') : 'Reject request'}
          danger={decision.action === 'reject'}
          optional={decision.action === 'approve'}
          onConfirm={async (note) => {
            await api(`/approvals/${decision.approval.id}/${decision.action}`, { method: 'POST', body: { note: note || undefined } });
            toast(decision.action === 'approve' ? `${isRefund(decision.approval) ? 'Refund' : 'Reversal'} approved and money returned.` : 'Request rejected.');
            reload();
          }}
          onClose={() => setDecision(null)}
        />
      )}
    </>
  );
}
