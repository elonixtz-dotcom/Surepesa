import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, Page } from '../lib/api';
import { day, money } from '../lib/format';
import { Badge, Empty, ErrorBox, Loading, PageHead, Pager, useApi } from '../components/ui';

interface CustomerRow {
  id: string;
  name: string;
  phoneNumber: string | null;
  email: string | null;
  status: string;
  kycStatus: string;
  balance: string | null;
  createdAt: string;
}

export function CustomersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const page = Number(params.get('page') ?? 1);
  const query = new URLSearchParams({ page: String(page), ...(params.get('q') && { q: params.get('q')! }), ...(params.get('status') && { status: params.get('status')! }) });
  const { data, error, loading } = useApi(() => api<Page<CustomerRow>>(`/customers?${query}`), [query.toString()]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setParams(q.trim() ? { q: q.trim() } : {});
  }

  return (
    <>
      <PageHead title="Customers" subtitle="Search by phone, email, name or SPX transaction reference." />
      <div className="card">
        <div className="card-head">
          <form className="toolbar" onSubmit={submit}>
            <input className="input" placeholder="Phone, email, name or SPX-…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
            <select
              value={params.get('status') ?? ''}
              onChange={(e) => setParams({ ...(q && { q }), ...(e.target.value && { status: e.target.value }) })}
              aria-label="Account status"
            >
              <option value="">All accounts</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="PENDING_VERIFICATION">Pending verification</option>
            </select>
            <button className="btn" type="submit">Search</button>
          </form>
        </div>
        {error != null && <div className="card-pad"><ErrorBox error={error} /></div>}
        {loading && !data ? <Loading /> : data && data.items.length === 0 ? <Empty>No customers match “{params.get('q')}”.</Empty> : data && (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Customer</th><th>Phone</th><th>Account</th><th>KYC</th><th className="num">TZS balance</th><th>Joined</th></tr></thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => navigate(`/customers/${c.id}`)}>
                      <td><span className="party"><span>{c.name}</span><small>{c.email}</small></span></td>
                      <td>{c.phoneNumber ?? <span className="muted">Not set</span>}</td>
                      <td><Badge value={c.status} /></td>
                      <td><Badge value={c.kycStatus} /></td>
                      <td className="num">{c.balance ? money(c.balance) : '—'}</td>
                      <td className="muted">{day(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setParams({ ...(params.get('q') && { q: params.get('q')! }), page: String(p) })} />
          </>
        )}
      </div>
    </>
  );
}
