import { useCallback, useEffect, useState } from 'react';
import { DEMO, loadOverview } from '../lib/api';
import { greeting, initials, relativeTime, short, splitMoney, titleCase } from '../lib/format';
import type { MerchantOverview, Money, OnboardingStep, Receipt } from '../lib/types';
import { RequestPaymentDialog } from '../components/RequestPaymentDialog';

export function Dashboard({ onSignOut }: { onSignOut: () => void }) {
  const [data, setData] = useState<MerchantOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(() => {
    loadOverview()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => (e?.status === 401 ? onSignOut() : setError(e instanceof Error ? e.message : 'Could not load your dashboard')));
  }, [onSignOut]);
  useEffect(load, [load]);

  if (error) {
    return (
      <div className="shell">
        <Topbar />
        <div className="card empty enter">
          <h3>We couldn't load your dashboard</h3>
          <p>{error}</p>
          <button className="btn" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (!data) return <Loading />;

  const { business, onboarding, stats } = data;
  const firstName = titleCase(data.owner.name).split(' ')[0];
  const setupDone = onboarding.done === onboarding.total;

  return (
    <>
      {DEMO && (
        <div className="banner">
          <span>Demo data</span>
          <a href="?demo=busy">Busy merchant</a>
          <a href="?demo=new">New merchant</a>
          <a href="?">Seeded</a>
        </div>
      )}
      <div className="shell">
        <Topbar data={data} onSignOut={onSignOut} />

        <section className="hero enter" style={{ ['--i' as string]: 0 }}>
          <div>
            <h1>{greeting()}, {firstName || 'there'}</h1>
            <p>{business.tradingName} · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>
          <div className="spacer" />
          <div className="hero-actions">
            <TillChip code={business.merchantCode} />
            <button className="btn primary" onClick={() => setRequesting(true)}>
              <span aria-hidden>＋</span> Request payment
            </button>
          </div>
        </section>

        {!setupDone && <Setup steps={onboarding.steps} done={onboarding.done} total={onboarding.total} />}

        <section className="grid stats" aria-label="Last 30 days">
          <Stat i={1} lead label="Available balance" money={business.balance} foot={data.openPaymentRequests ? `${data.openPaymentRequests} open payment request${data.openPaymentRequests > 1 ? 's' : ''}` : 'Ready to withdraw'} />
          <Stat i={2} label="Received, last 30 days" money={stats.volume30d} foot={<Trend now={stats.volume30d} prev={stats.volumePrev30d} />} />
          <Stat i={3} label="Payments, last 30 days" value={stats.payments30d.toLocaleString('en-US')} foot={stats.customers ? `from ${stats.customers.toLocaleString('en-US')} customer${stats.customers > 1 ? 's' : ''}` : 'No customers yet'} />
          <Stat
            i={4}
            label="Success rate"
            value={stats.successRate30d === null ? '—' : `${(stats.successRate30d * 100).toFixed(stats.successRate30d === 1 ? 0 : 1)}%`}
            foot={stats.successRate30d === null ? 'Shows after your first payment' : 'Of payment attempts, 30 days'}
          />
        </section>

        <section className="grid split">
          <div className="card enter" style={{ ['--i' as string]: 5 }}>
            <div className="card-head">
              <h2>Last 14 days</h2>
              <span className="muted">{short(sum(data.daily.map((d) => d.volume)))} received</span>
            </div>
            <VolumeChart daily={data.daily} />
          </div>
          <div className="card enter" style={{ ['--i' as string]: 6 }}>
            <div className="card-head">
              <h2>Recent payments</h2>
            </div>
            {data.recent.length ? (
              <ul className="payments">{data.recent.map((p) => <PaymentRow key={p.reference} p={p} />)}</ul>
            ) : (
              <div className="empty">
                <h3>No payments yet</h3>
                <p>Customers can pay to till <b>{business.merchantCode}</b> from any mobile money app, or scan a payment request.</p>
                <button className="btn primary" onClick={() => setRequesting(true)}>Create your first request</button>
              </div>
            )}
          </div>
        </section>
      </div>

      <RequestPaymentDialog open={requesting} merchantCode={business.merchantCode} onClose={() => setRequesting(false)} />
    </>
  );
}

function Topbar({ data, onSignOut }: { data?: MerchantOverview; onSignOut?: () => void }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden>₷</div>
        <span>SurePesa <small>for Business</small></span>
      </div>
      <div className="spacer" />
      {data && (
        <div className="account">
          <div className="account-name">
            <b>{titleCase(data.owner.name) || 'Merchant'}</b>
            <span>{data.business.legalName}</span>
          </div>
          <div className="avatar" aria-hidden>{initials(data.owner.name)}</div>
          {onSignOut && <button className="btn ghost sm" onClick={onSignOut}>Sign out</button>}
        </div>
      )}
    </header>
  );
}

function TillChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="chip">
      Till <code>{code}</code>
      <button
        className="btn ghost sm"
        aria-label={`Copy till number ${code}`}
        onClick={async () => {
          await navigator.clipboard.writeText(code).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const STEP_ACTION: Record<OnboardingStep['key'], string> = {
  details: 'Add details',
  verification: 'Upload',
  payout: 'Link account',
  first_payment: 'Request payment',
};

function Setup({ steps, done, total }: { steps: OnboardingStep[]; done: number; total: number }) {
  const next = steps.find((s) => !s.done && s.state !== 'PENDING');
  return (
    <section className="card setup enter" style={{ ['--i' as string]: 1 }} aria-labelledby="setup-title">
      <div>
        <h2 id="setup-title">Finish setting up</h2>
        <p>Verified businesses can withdraw to their account and take card payments. It takes about 10 minutes.</p>
        <div className="segments" style={{ ['--n' as string]: total }} aria-hidden>
          {steps.map((s, i) => <i key={s.key} className={i < done ? 'on' : ''} />)}
        </div>
        <div className="setup-count">{done} of {total} done</div>
      </div>
      <ol className="steps">
        {steps.map((s, i) => {
          const state = s.done ? 'done' : s === next ? 'next' : '';
          return (
            <li key={s.key} className={`step ${state}`}>
              <span className="step-icon" aria-hidden>{s.done ? '✓' : i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div className="step-title">{s.label}</div>
                <div className="step-detail">{s.detail}</div>
              </div>
              {s.state === 'PENDING' ? (
                <span className="pill warn">In review</span>
              ) : s.state === 'REJECTED' ? (
                <span className="pill bad">Needs changes</span>
              ) : (
                state === 'next' && <button className="btn sm primary">{STEP_ACTION[s.key]}</button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Stat({ i, label, money, value, foot, lead }: { i: number; label: string; money?: Money; value?: string; foot?: React.ReactNode; lead?: boolean }) {
  const m = money ? splitMoney(money) : null;
  return (
    <div className={`card stat enter${lead ? ' lead' : ''}`} style={{ ['--i' as string]: i + 1 }}>
      <span className="stat-label">{label}</span>
      <span className="stat-value num">
        {m ? (<><small>{m.currency}</small>{m.amount}</>) : value}
      </span>
      {foot && <span className="stat-foot">{foot}</span>}
    </div>
  );
}

function Trend({ now, prev }: { now: Money; prev: Money }) {
  const a = Number(now.value);
  const b = Number(prev.value);
  if (!a && !b) return <>Nothing received yet</>;
  if (!b) return <>Your first month</>;
  const pct = ((a - b) / b) * 100;
  const up = pct >= 0;
  return (
    <span className={`trend ${up ? 'up' : 'down'}`}>
      {up ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}% <span className="muted">vs previous 30 days</span>
    </span>
  );
}

function VolumeChart({ daily }: { daily: MerchantOverview['daily'] }) {
  const max = Math.max(...daily.map((d) => Number(d.volume.value)), 1);
  const label = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <>
      <div className="chart" role="img" aria-label={`Daily amounts received over the last 14 days, highest ${short(daily.reduce((a, d) => (Number(d.volume.value) > Number(a.value) ? d.volume : a), daily[0]!.volume))}`}>
        {daily.map((d, i) => {
          const v = Number(d.volume.value);
          return (
            <div className="bar-col" key={d.day} tabIndex={0}>
              <div
                className={`bar${i === daily.length - 1 ? ' today' : ''}${v === 0 ? ' zero' : ''}`}
                style={{ height: `${Math.max((v / max) * 100, 2)}%`, ['--i' as string]: i }}
              />
              <span className="tip num">{label(d.day)} · {short(d.volume)} · {d.count} payment{d.count === 1 ? '' : 's'}</span>
            </div>
          );
        })}
      </div>
      <div className="chart-axis"><span>{label(daily[0]!.day)}</span><span>Today</span></div>
    </>
  );
}

function PaymentRow({ p }: { p: Receipt }) {
  const failed = p.status === 'FAILED';
  const name = titleCase(p.counterparty?.name) || 'Customer';
  return (
    <li className={`payment${failed ? ' failed' : ''}`}>
      <div className="avatar" aria-hidden>{initials(p.counterparty?.name)}</div>
      <div style={{ minWidth: 0 }}>
        <div className="payment-name">{name}</div>
        <div className="payment-meta">{relativeTime(p.createdAt)} · {p.reference}</div>
      </div>
      <div className="payment-amount">
        <div className="num">{short(p.amount)}</div>
        {failed ? (
          <span className="pill bad">Failed</span>
        ) : p.refunded ? (
          <span className="pill warn">{short(p.refunded)} refunded</span>
        ) : p.status === 'REVERSED' ? (
          <span className="pill">Reversed</span>
        ) : null}
      </div>
    </li>
  );
}

function Loading() {
  return (
    <div className="shell" aria-busy="true">
      <Topbar />
      <div className="grid stats" style={{ marginTop: 92 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}
      </div>
      <div className="grid split"><div className="skeleton" style={{ height: 280 }} /><div className="skeleton" style={{ height: 280 }} /></div>
    </div>
  );
}

function sum(values: Money[]): Money {
  const total = values.reduce((s, m) => s + Number(m.value), 0);
  return { value: total.toFixed(2), formatted: `TZS ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` };
}
