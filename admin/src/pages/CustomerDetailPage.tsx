import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, CaseSummary, Txn } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago, day, humanize, initials, money, when } from '../lib/format';
import { Badge, ErrorBox, Loading, PageHead, ReasonModal, toast, TxnTable, useApi } from '../components/ui';

interface Customer360 {
  id: string;
  name: string;
  phoneNumber: string | null;
  email: string | null;
  status: string;
  kycStatus: string;
  accountType: string;
  createdAt: string;
  lastLoginAt: string | null;
  profile: { firstName: string; lastName: string; region: string | null; dateOfBirth: string | null } | null;
  wallets: { id: string; currency: string; balance: string; status: string }[];
  transactions: Txn[];
  kyc: { id: string; status: string; idType: string; idNumber: string; submittedAt: string; reviewedBy: string | null; rejectionReason: string | null }[];
  cases: { id: string; reference: string; subject: string; status: string; priority: string; category: string; assignedTo: string | null; createdAt: string }[];
}

const CATEGORIES = ['PAYMENT_ISSUE', 'WRONG_RECIPIENT', 'ACCOUNT_ACCESS', 'KYC', 'FRAUD_REPORT', 'GENERAL'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/** Customer 360: everything an agent needs on one screen during a call. Opening it is audited. */
export function CustomerDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: c, error, loading, reload } = useApi(() => api<Customer360>(`/customers/${id}`), [id]);
  const [newCase, setNewCase] = useState(false);
  const [statusChange, setStatusChange] = useState<'SUSPENDED' | 'ACTIVE' | null>(null);

  if (error != null) return <ErrorBox error={error} />;
  if (loading && !c) return <div className="card"><Loading rows={8} /></div>;
  if (!c) return null;

  const tzs = c.wallets.find((w) => w.currency === 'TZS');

  return (
    <>
      <PageHead
        title={c.name}
        subtitle={<>{c.phoneNumber ?? 'No phone'} · {c.email} · customer since {day(c.createdAt)}</>}
        actions={
          <>
            {can('customers:status') && (
              c.status === 'SUSPENDED'
                ? <button className="btn" onClick={() => setStatusChange('ACTIVE')}>Reactivate account</button>
                : <button className="btn danger" onClick={() => setStatusChange('SUSPENDED')}>Suspend account</button>
            )}
            {can('cases:manage') && <button className="btn primary" onClick={() => setNewCase(true)}>Open case</button>}
          </>
        }
      />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card stat" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="avatar" style={{ width: 44, height: 44, fontSize: 15 }}>{initials(c.name)}</div>
          <div>
            <div className="stat-label">Account</div>
            <Badge value={c.status} />
          </div>
        </div>
        <div className="card stat">
          <div className="stat-label">Identity (KYC)</div>
          <div style={{ marginTop: 6 }}><Badge value={c.kycStatus} /></div>
          <div className="stat-sub">{c.kycStatus === 'APPROVED' ? 'Can send money' : 'Cannot send money yet'}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">TZS wallet balance</div>
          <div className="stat-value">{tzs ? money(tzs.balance) : '—'}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Last app sign-in</div>
          <div className="stat-value" style={{ fontSize: 18 }}>{c.lastLoginAt ? ago(c.lastLoginAt) : 'Not recorded'}</div>
        </div>
      </div>

      <div className="grid cols-main">
        <div className="card">
          <div className="card-head"><h2>Recent transactions</h2><Link to={`/transactions?q=${encodeURIComponent(c.phoneNumber ?? '')}`}>All transactions</Link></div>
          <TxnTable items={c.transactions} showDirection />
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <div className="card-head"><h2>Support cases</h2></div>
            <div className="card-pad grid" style={{ gap: 10 }}>
              {c.cases.length === 0 && <span className="muted">No previous cases.</span>}
              {c.cases.map((k) => (
                <Link key={k.id} to={`/cases/${k.id}`} className="note" style={{ color: 'inherit' }}>
                  <div className="note-meta"><span className="mono">{k.reference}</span> · {ago(k.createdAt)}</div>
                  <div style={{ fontWeight: 600 }}>{k.subject}</div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 6 }}><Badge value={k.status} /><Badge value={k.priority} /></div>
                </Link>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Identity submissions</h2></div>
            <div className="card-pad grid" style={{ gap: 10 }}>
              {c.kyc.length === 0 && <span className="muted">Never submitted.</span>}
              {c.kyc.map((k) => (
                <div key={k.id} className="note">
                  <div className="note-meta">{when(k.submittedAt)}{k.reviewedBy ? ` · reviewed by ${k.reviewedBy}` : ''}</div>
                  {humanize(k.idType)} <span className="mono">{k.idNumber}</span> <Badge value={k.status} />
                  {k.rejectionReason && <div className="muted">{k.rejectionReason}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {newCase && <NewCaseModal customer={c} onClose={() => setNewCase(false)} />}
      {statusChange && (
        <ReasonModal
          title={statusChange === 'SUSPENDED' ? `Suspend ${c.name}?` : `Reactivate ${c.name}?`}
          description={statusChange === 'SUSPENDED' ? 'The customer will be blocked from all payments until reactivated.' : 'The customer will be able to use their wallet again.'}
          label="Reason (recorded in the audit log)"
          confirmLabel={statusChange === 'SUSPENDED' ? 'Suspend' : 'Reactivate'}
          danger={statusChange === 'SUSPENDED'}
          onConfirm={async (reason) => {
            await api(`/customers/${c.id}/status`, { method: 'POST', body: { status: statusChange, reason } });
            toast(statusChange === 'SUSPENDED' ? 'Account suspended.' : 'Account reactivated.');
            reload();
          }}
          onClose={() => setStatusChange(null)}
        />
      )}
    </>
  );
}

function NewCaseModal({ customer, onClose }: { customer: Customer360; onClose: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ category: 'PAYMENT_ISSUE', priority: 'NORMAL', subject: '', transactionReference: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await api<CaseSummary>('/cases', {
        method: 'POST',
        body: { userId: customer.id, ...form, transactionReference: form.transactionReference || undefined },
      });
      toast(`Case ${created.reference} opened.`);
      navigate(`/cases/${created.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Open case" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Open a case for {customer.name}</h2>
        <div className="grid cols-2" style={{ gap: 12 }}>
          <label className="field">Category
            <select value={form.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>
          </label>
          <label className="field">Priority
            <select value={form.priority} onChange={set('priority')}>{PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</select>
          </label>
        </div>
        <label className="field">Subject
          <input className="input" value={form.subject} onChange={set('subject')} placeholder="e.g. Sent TZS 35,000 to the wrong number" />
        </label>
        <label className="field">Transaction reference (optional)
          <input className="input mono" value={form.transactionReference} onChange={set('transactionReference')} placeholder="SPX-…" list="customer-txns" />
          <datalist id="customer-txns">
            {customer.transactions.map((t) => <option key={t.id} value={t.reference}>{money(t.amount)} · {humanize(t.type)}</option>)}
          </datalist>
        </label>
        <label className="field">What did the customer report?
          <textarea value={form.note} onChange={set('note')} />
        </label>
        {error != null && <ErrorBox error={error} />}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy || form.subject.trim().length < 5 || !form.note.trim()}>
            {busy ? 'Opening…' : 'Open case'}
          </button>
        </div>
      </div>
    </div>
  );
}
