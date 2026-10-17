import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { day, fromMinor, humanize, toMinor, when } from '../lib/format';
import { Badge, Empty, ErrorBox, Loading, PageHead, toast, useApi } from '../components/ui';

interface FeeRule {
  id: string;
  transactionType: string;
  bps: number;
  minFee: string;
  maxFee: string | null;
  note: string | null;
  active: boolean;
  effectiveFrom: string;
  createdAt: string;
}

interface FeeDefault {
  transactionType: string;
  bps: number;
  minFee: string;
  maxFee: string | null;
}

/** Types customers can be charged for; reversals, refunds and adjustments never carry a fee. */
const FEE_TYPES = ['DEPOSIT', 'WITHDRAWAL', 'P2P_TRANSFER', 'MERCHANT_PAYMENT', 'FX_CONVERSION'] as const;

const percent = (bps: number) => `${(bps / 100).toLocaleString('en', { maximumFractionDigits: 2 })}%`;

function describe(r: { bps: number; minFee: string; maxFee: string | null }) {
  if (r.bps === 0 && r.minFee === '0' && r.maxFee === null) return 'Free';
  return `${percent(r.bps)} · min ${fromMinor(r.minFee)} · ${r.maxFee === null ? 'no cap' : `cap ${fromMinor(r.maxFee)}`}`;
}

/**
 * Fee schedule and regulatory caps. Rules are never edited: a change is a new rule with its
 * own effective date that supersedes the previous one, so what customers were charged stays
 * traceable.
 */
export function FeesPage() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi(() => api<{ rules: FeeRule[]; defaults: FeeDefault[] }>('/fees'), []);
  const now = Date.now();

  const inForce = (type: string) =>
    data?.rules
      .filter((r) => r.transactionType === type && r.active && new Date(r.effectiveFrom).getTime() <= now)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const scheduled = (type: string) =>
    data?.rules.filter((r) => r.transactionType === type && r.active && new Date(r.effectiveFrom).getTime() > now) ?? [];
  const types = data
    ? [...new Set<string>([...FEE_TYPES, ...data.defaults.map((d) => d.transactionType), ...data.rules.map((r) => r.transactionType)])]
    : [];

  return (
    <>
      <PageHead
        title="Fees"
        subtitle="What customers pay, including regulatory caps. Rules are never edited: a new rule supersedes the old one from its effective date, and the history stays."
      />
      {error != null && <ErrorBox error={error} />}
      {loading && !data && <div className="card"><Loading /></div>}
      {data && (
        <div className="grid">
          <div className="card">
            <div className="card-head"><h2>In force now</h2><span className="muted">Types without a rule use the built-in default</span></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Transaction type</th><th>Fee</th><th>Source</th><th>Coming up</th></tr></thead>
                <tbody>
                  {types.map((type) => {
                    const rule = inForce(type);
                    const fallback = data.defaults.find((d) => d.transactionType === type);
                    const upcoming = scheduled(type);
                    return (
                      <tr key={type}>
                        <td style={{ fontWeight: 600 }}>{humanize(type)}</td>
                        <td>{rule ? describe(rule) : fallback ? describe(fallback) : 'Free'}</td>
                        <td>
                          {rule ? (
                            <>Rule since {day(rule.effectiveFrom)}{rule.note && <div className="muted" style={{ fontSize: 12.5 }}>{rule.note}</div>}</>
                          ) : <span className="muted">Built-in default</span>}
                        </td>
                        <td className="muted">
                          {upcoming.length === 0 ? '—' : upcoming.map((u) => <div key={u.id}>{describe(u)} from {when(u.effectiveFrom)}</div>)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {can('fees:manage') && <NewRuleForm onCreated={reload} />}

          <div className="card">
            <div className="card-head"><h2>Rule history</h2><span className="muted">Newest first within each type</span></div>
            {data.rules.length === 0 ? <Empty>No rules yet. Every type uses its built-in default.</Empty> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Type</th><th>Fee</th><th>Effective from</th><th>Status</th><th>Reason</th></tr></thead>
                  <tbody>
                    {data.rules.map((r) => {
                      const current = inForce(r.transactionType)?.id === r.id;
                      const future = r.active && new Date(r.effectiveFrom).getTime() > now;
                      return (
                        <tr key={r.id}>
                          <td>{humanize(r.transactionType)}</td>
                          <td>{describe(r)}</td>
                          <td className="muted">{when(r.effectiveFrom)}</td>
                          <td>{current ? <Badge value="ACTIVE" /> : future ? <span className="badge info">Scheduled</span> : <span className="badge">Superseded</span>}</td>
                          <td className="muted">{r.note ?? '—'}</td>
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

function NewRuleForm({ onCreated }: { onCreated: () => void }) {
  const [type, setType] = useState<string>('WITHDRAWAL');
  const [bps, setBps] = useState('');
  const [minFee, setMinFee] = useState('0');
  const [maxFee, setMaxFee] = useState('');
  const [note, setNote] = useState('');
  const [effective, setEffective] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const bpsNum = Number(bps);
  const bpsValid = bps !== '' && Number.isInteger(bpsNum) && bpsNum >= 0 && bpsNum <= 10_000;
  const minMinor = toMinor(minFee);
  const maxMinor = maxFee.trim() === '' ? null : toMinor(maxFee);
  const maxValid = maxFee.trim() === '' || maxMinor !== null;
  const capOrder = minMinor === null || maxMinor === null || BigInt(maxMinor) >= BigInt(minMinor);
  const valid = bpsValid && minMinor !== null && maxValid && capOrder && note.trim().length >= 5;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api('/fees', {
        method: 'POST',
        body: {
          transactionType: type,
          bps: bpsNum,
          minFee: minMinor,
          maxFee: maxMinor,
          note: note.trim(),
          ...(effective ? { effectiveFrom: new Date(effective).toISOString() } : {}),
        },
      });
      toast(`New ${humanize(type).toLowerCase()} fee rule saved.`);
      setBps(''); setMinFee('0'); setMaxFee(''); setNote(''); setEffective('');
      onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-head"><h2>New fee rule</h2><span className="muted">Supersedes the current rule for that type; it's audited</span></div>
      <div className="card-pad grid" style={{ gap: 14 }}>
        <div className="form-grid">
          <label className="field">
            Transaction type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {FEE_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </label>
          <label className="field">
            Percentage (basis points)
            <input className="input" inputMode="numeric" value={bps} onChange={(e) => setBps(e.target.value)} placeholder="50 = 0.5%" />
            <span className="muted" style={{ fontWeight: 400 }}>{bpsValid ? `${percent(bpsNum)} of the amount` : '100 basis points = 1%, whole numbers 0 to 10,000'}</span>
          </label>
          <label className="field">
            Minimum fee (TZS)
            <input className="input" inputMode="decimal" value={minFee} onChange={(e) => setMinFee(e.target.value)} />
            {minMinor === null && <span style={{ color: 'var(--bad)', fontWeight: 400 }}>Enter an amount like 500 or 500.00</span>}
          </label>
          <label className="field">
            Maximum fee / cap (TZS)
            <input className="input" inputMode="decimal" value={maxFee} onChange={(e) => setMaxFee(e.target.value)} placeholder="Leave empty for no cap" />
            {!maxValid && <span style={{ color: 'var(--bad)', fontWeight: 400 }}>Enter an amount like 5,000</span>}
            {maxValid && !capOrder && <span style={{ color: 'var(--bad)', fontWeight: 400 }}>The cap must be at least the minimum</span>}
          </label>
          <label className="field">
            Effective from (optional)
            <input className="input" type="datetime-local" value={effective} onChange={(e) => setEffective(e.target.value)} />
            <span className="muted" style={{ fontWeight: 400 }}>Empty means immediately. Your local time.</span>
          </label>
          <label className="field full">
            Reason
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. BoT circular on mobile-money charges, effective 1 Nov" />
          </label>
        </div>
        <div className="alert warn" style={{ fontWeight: 500 }}>
          This doesn't change existing rules. It adds a new one; from its effective date the current rule for {humanize(type).toLowerCase()} stops applying. To undo, add another rule.
        </div>
        {error != null && <ErrorBox error={error} />}
        <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
          <button className="btn primary" type="submit" disabled={!valid || busy}>{busy ? 'Saving…' : 'Add rule'}</button>
        </div>
      </div>
    </form>
  );
}
