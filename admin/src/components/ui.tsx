import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, Party, Txn } from '../lib/api';
import { humanize, money, when } from '../lib/format';

// ── Status badges: always a text label, never colour alone ──

const TONES: Record<string, 'good' | 'warn' | 'bad' | 'info' | ''> = {
  SUCCESS: 'good', APPROVED: 'good', ACTIVE: 'good', RESOLVED: 'good', VERIFIED: 'good',
  PENDING: 'warn', PROCESSING: 'warn', IN_PROGRESS: 'info', OPEN: 'info', ESCALATED: 'warn', PENDING_VERIFICATION: 'warn',
  FAILED: 'bad', REJECTED: 'bad', SUSPENDED: 'bad', REVERSED: 'info', CANCELLED: '', CLOSED: '', NOT_STARTED: '',
  URGENT: 'bad', HIGH: 'warn', NORMAL: '', LOW: '',
};

export function Badge({ value }: { value: string }) {
  return <span className={`badge ${TONES[value] ?? ''}`}>{humanize(value)}</span>;
}

export function PartyCell({ party }: { party: Party | null }) {
  if (!party) return <span className="muted">—</span>;
  return (
    <span className="party">
      <span>{party.name}</span>
      {party.detail && <small className={party.kind === 'SYSTEM' ? 'mono' : ''}>{party.detail}</small>}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="toolbar">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card-pad grid" style={{ gap: 10 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 18, width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const message = error instanceof ApiError ? error.message : 'Something went wrong.';
  return <div className="alert bad" role="alert">{message}</div>;
}

/** Transaction table used by monitors, customer 360 and dashboards. */
export function TxnTable({ items, showDirection = false }: { items: Txn[]; showDirection?: boolean }) {
  const navigate = useNavigate();
  if (!items.length) return <Empty>No transactions match.</Empty>;
  if (showDirection) return <CompactTxnTable items={items} />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Type</th>
            <th>From</th>
            <th>To</th>
            <th className="num">Amount</th>
            <th>Status</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="clickable" onClick={() => navigate(`/transactions/${t.id}`)}>
              <td className="mono">{t.reference}</td>
              <td>{humanize(t.type)}</td>
              <td><PartyCell party={t.from} /></td>
              <td><PartyCell party={t.to} /></td>
              <td className="num">
                {showDirection && t.direction ? (t.direction === 'IN' ? '+ ' : '− ') : ''}
                {money(t.amount, t.currency)}
              </td>
              <td>
                <Badge value={t.status} />
                {t.failureCode && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{humanize(t.failureCode)}</div>}
              </td>
              <td className="muted">{when(t.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Narrow variant for a single customer's activity: one counterparty column, date under the reference. */
function CompactTxnTable({ items }: { items: Txn[] }) {
  const navigate = useNavigate();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Reference</th><th>Type</th><th>Counterparty</th><th className="num">Amount</th><th>Status</th></tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="clickable" onClick={() => navigate(`/transactions/${t.id}`)}>
              <td style={{ whiteSpace: 'nowrap' }}>
                <span className="mono">{t.reference}</span>
                <div className="muted" style={{ fontSize: 12 }}>{when(t.createdAt)}</div>
              </td>
              <td>{humanize(t.type)}</td>
              <td><PartyCell party={t.direction === 'IN' ? t.from : t.to} /></td>
              <td className="num">{t.direction === 'IN' ? '+ ' : '− '}{money(t.amount, t.currency)}</td>
              <td><Badge value={t.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="toolbar" style={{ justifyContent: 'space-between', padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
      <span className="muted">{total.toLocaleString()} results · page {page} of {pages}</span>
      <div className="toolbar">
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

/** Modal that collects a reason / note before a sensitive action. */
export function ReasonModal(props: {
  title: string;
  description?: ReactNode;
  label: string;
  confirmLabel: string;
  danger?: boolean;
  minLength?: number;
  optional?: boolean;
  onConfirm: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const min = props.optional ? 0 : (props.minLength ?? 5);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm(text.trim());
      props.onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={props.title} onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{props.title}</h2>
        {props.description && <div className="muted">{props.description}</div>}
        <label className="field">
          {props.label}
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {error != null && <ErrorBox error={error} />}
        <div className="modal-actions">
          <button className="btn" onClick={props.onClose} disabled={busy}>Cancel</button>
          <button className={`btn ${props.danger ? 'danger' : 'primary'}`} disabled={busy || text.trim().length < min} onClick={submit}>
            {busy ? 'Working…' : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Data hook ──

export function useApi<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // Only the newest request may update state: with slow responses, an older load that
  // finishes last would otherwise overwrite fresher data.
  const latest = useRef(0);
  const reload = useCallback(() => {
    const id = ++latest.current;
    setLoading(true);
    load()
      .then((d) => {
        if (id !== latest.current) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (id === latest.current) setError(e);
      })
      .finally(() => {
        if (id === latest.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, loading, reload };
}

// ── Toast ──

let pushToast: (msg: string, tone?: 'bad') => void = () => {};
export const toast = (msg: string, tone?: 'bad') => pushToast(msg, tone);

export function ToastHost() {
  const [item, setItem] = useState<{ msg: string; tone?: 'bad' } | null>(null);
  useEffect(() => {
    pushToast = (msg, tone) => setItem({ msg, tone });
  }, []);
  useEffect(() => {
    if (!item) return;
    const t = setTimeout(() => setItem(null), 4000);
    return () => clearTimeout(t);
  }, [item]);
  return item ? <div className={`toast ${item.tone ?? ''}`} role="status">{item.msg}</div> : null;
}
