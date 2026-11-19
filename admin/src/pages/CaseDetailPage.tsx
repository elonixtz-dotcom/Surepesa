import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, CaseSummary } from '../lib/api';
import { useAuth } from '../lib/auth';
import { humanize, when } from '../lib/format';
import { Badge, ErrorBox, Loading, PageHead, ReasonModal, toast, useApi } from '../components/ui';

interface CaseDetail extends CaseSummary {
  notes: { id: string; body: string; author: string; role: string; createdAt: string }[];
  approvals: { id: string; status: string; reason: string; requestedBy: string; decidedBy: string | null; decisionNote: string | null; createdAt: string }[];
}

const STATUSES = ['OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export function CaseDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: c, error, loading, reload } = useApi(() => api<CaseDetail>(`/cases/${id}`), [id]);
  const staff = useApi(() => api<{ id: string; fullName: string; role: string }[]>('/staff'), []);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [requestReversal, setRequestReversal] = useState(false);

  if (error != null) return <ErrorBox error={error} />;
  if (loading && !c) return <div className="card"><Loading rows={8} /></div>;
  if (!c) return null;

  const editable = can('cases:manage');
  const pendingReversal = c.approvals.some((a) => a.status === 'PENDING');
  const reversalDone = c.approvals.some((a) => a.status === 'APPROVED');

  async function update(body: Record<string, unknown>) {
    try {
      await api(`/cases/${c!.id}`, { method: 'PATCH', body });
      toast('Case updated.');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed', 'bad');
    }
  }

  async function addNote() {
    setSaving(true);
    try {
      await api(`/cases/${c!.id}/notes`, { method: 'POST', body: { body: note } });
      setNote('');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add note', 'bad');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHead
        title={c.subject}
        subtitle={<><span className="mono">{c.reference}</span> · {humanize(c.category)} · opened {when(c.createdAt)} by {c.createdBy.fullName}</>}
        actions={editable && c.status !== 'RESOLVED' && c.status !== 'CLOSED' && (
          <button className="btn primary" onClick={() => update({ status: 'RESOLVED' })}>Mark resolved</button>
        )}
      />
      <div className="grid cols-main">
        <div className="card">
          <div className="card-head"><h2>Case notes</h2><span className="muted">Internal; never shown to the customer</span></div>
          <div className="card-pad grid" style={{ gap: 10 }}>
            {c.notes.map((n) => (
              <div key={n.id} className="note">
                <div className="note-meta"><strong>{n.author}</strong> · {humanize(n.role)} · {when(n.createdAt)}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
              </div>
            ))}
            {editable && (
              <div className="grid" style={{ gap: 8 }}>
                <textarea placeholder="Add a note: what you did, what the customer said, next step…" value={note} onChange={(e) => setNote(e.target.value)} aria-label="New note" />
                <div><button className="btn" disabled={saving || !note.trim()} onClick={addNote}>{saving ? 'Saving…' : 'Add note'}</button></div>
              </div>
            )}
          </div>
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card card-pad">
            <dl className="kv" style={{ gridTemplateColumns: '110px 1fr' }}>
              <dt>Customer</dt>
              <dd><Link to={`/customers/${c.customer.id}`}>{c.customer.name}</Link><div className="muted">{c.customer.phoneNumber}</div></dd>
              <dt>Transaction</dt>
              <dd>{c.transaction ? <><Link to={`/transactions/${c.transaction.id}`} className="mono">{c.transaction.reference}</Link> <Badge value={c.transaction.status} /></> : '—'}</dd>
              <dt>Status</dt>
              <dd>{editable ? (
                <select value={c.status} onChange={(e) => update({ status: e.target.value })} aria-label="Case status">
                  {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </select>
              ) : <Badge value={c.status} />}</dd>
              <dt>Priority</dt>
              <dd>{editable ? (
                <select value={c.priority} onChange={(e) => update({ priority: e.target.value })} aria-label="Priority">
                  {PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
                </select>
              ) : <Badge value={c.priority} />}</dd>
              <dt>Assigned to</dt>
              <dd>{editable ? (
                <select value={c.assignedTo?.id ?? ''} onChange={(e) => update({ assignedToId: e.target.value || null })} aria-label="Assignee">
                  <option value="">Unassigned</option>
                  {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName} ({humanize(s.role)})</option>)}
                </select>
              ) : (c.assignedTo?.fullName ?? 'Unassigned')}</dd>
            </dl>
          </div>

          {c.transaction && can('approvals:request') && (
            <div className="card card-pad grid" style={{ gap: 10 }}>
              <h2>Refund / reversal</h2>
              {c.approvals.map((a) => (
                <div key={a.id} className="note">
                  <div className="note-meta">Requested by {a.requestedBy} · {when(a.createdAt)}</div>
                  <Badge value={a.status} /> {a.reason}
                  {a.decidedBy && <div className="muted" style={{ marginTop: 4 }}>{a.decidedBy}{a.decisionNote ? `: ${a.decisionNote}` : ''}</div>}
                </div>
              ))}
              {!pendingReversal && !reversalDone && c.transaction.status === 'SUCCESS' && (
                <>
                  <p className="muted" style={{ margin: 0 }}>You can't move money yourself. A reversal request goes to Finance for approval.</p>
                  <div><button className="btn danger" onClick={() => setRequestReversal(true)}>Request reversal</button></div>
                </>
              )}
              {pendingReversal && <div className="alert warn">Waiting for Finance to decide.</div>}
            </div>
          )}
        </div>
      </div>

      {requestReversal && c.transaction && (
        <ReasonModal
          title={`Request reversal of ${c.transaction.reference}`}
          description="Finance (or the System Controller) will review. The case moves to Escalated."
          label="Why should this be reversed?"
          confirmLabel="Send for approval"
          minLength={10}
          onConfirm={async (reason) => {
            await api('/approvals', { method: 'POST', body: { transactionId: c.transaction!.id, caseId: c.id, reason } });
            toast('Reversal request sent to Finance.');
            reload();
          }}
          onClose={() => setRequestReversal(false)}
        />
      )}
    </>
  );
}
