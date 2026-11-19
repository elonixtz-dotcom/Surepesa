import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, Page, Txn } from '../lib/api';
import { ErrorBox, Loading, PageHead, Pager, TxnTable, useApi } from '../components/ui';

const STATUSES = ['', 'SUCCESS', 'FAILED', 'PROCESSING', 'PENDING', 'REVERSED', 'CANCELLED'];
const TYPES = ['', 'P2P_TRANSFER', 'MERCHANT_PAYMENT', 'DEPOSIT', 'WITHDRAWAL', 'REVERSAL', 'FX_CONVERSION', 'ADJUSTMENT'];
const label = (v: string) => (v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ') : 'All');

/** Transaction monitor: filter by status/type, search by SPX reference or phone number. */
export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const status = params.get('status') ?? '';
  const type = params.get('type') ?? '';
  const page = Number(params.get('page') ?? 1);

  const query = new URLSearchParams({ page: String(page), ...(status && { status }), ...(type && { type }), ...(params.get('q') && { q: params.get('q')! }) });
  const { data, error, loading } = useApi(() => api<Page<Txn>>(`/transactions?${query}`), [query.toString()]);

  const update = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v ? merged.set(k, v) : merged.delete(k)));
    if (!('page' in next)) merged.delete('page');
    setParams(merged);
  };

  return (
    <>
      <PageHead title="Transactions" subtitle="Every payment, with its full status history and ledger postings." />
      <div className="card">
        <div className="card-head">
          <form className="toolbar" onSubmit={(e) => { e.preventDefault(); update({ q }); }}>
            <input className="input" placeholder="SPX reference or phone number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
            <select value={status} onChange={(e) => update({ status: e.target.value })} aria-label="Status">
              {STATUSES.map((s) => <option key={s} value={s}>{s ? label(s) : 'All statuses'}</option>)}
            </select>
            <select value={type} onChange={(e) => update({ type: e.target.value })} aria-label="Type">
              {TYPES.map((t) => <option key={t} value={t}>{t ? label(t) : 'All types'}</option>)}
            </select>
            <button className="btn" type="submit">Search</button>
          </form>
        </div>
        {error != null && <div className="card-pad"><ErrorBox error={error} /></div>}
        {loading && !data ? <Loading /> : data && (
          <>
            <TxnTable items={data.items} />
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => update({ page: String(p) })} />
          </>
        )}
      </div>
    </>
  );
}
