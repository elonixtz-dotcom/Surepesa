import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, CaseSummary, Page } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago } from '../lib/format';
import { Badge, Empty, ErrorBox, Loading, PageHead, Stat, useApi } from '../components/ui';

/**
 * Customer Service home. The agent's first move on a call is to find the customer, so
 * search is the hero; their own open cases sit underneath, most urgent first.
 */
export function SupportDeskPage() {
  const { staff } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const mine = useApi(() => api<Page<CaseSummary>>('/cases?mine=1&open=1&pageSize=50'), []);
  const all = useApi(() => api<Page<CaseSummary>>('/cases?open=1&pageSize=5'), []);

  function search(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    // An SPX reference goes straight to the transaction; anything else searches customers.
    if (/^SPX-[0-9A-Z]{10}$/i.test(term)) navigate(`/transactions/${term.toUpperCase()}`);
    else navigate(`/customers?q=${encodeURIComponent(term)}`);
  }

  const urgent = mine.data?.items.filter((c) => c.priority === 'URGENT' || c.priority === 'HIGH').length ?? 0;
  const escalated = mine.data?.items.filter((c) => c.status === 'ESCALATED').length ?? 0;

  return (
    <>
      <PageHead title={`Karibu, ${staff!.fullName.split(' ')[0]}`} subtitle="Find a customer by phone, email, name or transaction reference." />
      <form className="card card-pad search-hero" onSubmit={search} style={{ marginBottom: 16 }}>
        <input
          className="input"
          autoFocus
          placeholder="e.g. 0712 345 678 · halca@… · SPX-7K2M9QX4TB"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search customers or transactions"
        />
        <button className="btn primary" type="submit">Search</button>
      </form>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="My open cases" value={mine.data?.total ?? '—'} />
        <Stat label="High / urgent" value={mine.data ? urgent : '—'} />
        <Stat label="Escalated to approvers" value={mine.data ? escalated : '—'} sub="Waiting on Finance" />
        <Stat label="Open cases, whole team" value={all.data?.total ?? '—'} />
      </div>

      <div className="card">
        <div className="card-head"><h2>My open cases</h2></div>
        {mine.error != null && <div className="card-pad"><ErrorBox error={mine.error} /></div>}
        {mine.loading && !mine.data ? <Loading /> : mine.data && mine.data.items.length === 0 ? (
          <Empty>No open cases assigned to you. Nice work.</Empty>
        ) : mine.data && <CaseTable items={mine.data.items} />}
      </div>
    </>
  );
}

export function CaseTable({ items, showAssignee = false }: { items: CaseSummary[]; showAssignee?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Case</th><th>Customer</th><th>Subject</th><th>Priority</th><th>Status</th>{showAssignee && <th>Assigned to</th>}<th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="clickable" onClick={() => navigate(`/cases/${c.id}`)}>
              <td className="mono">{c.reference}</td>
              <td><span className="party"><span>{c.customer.name}</span><small>{c.customer.phoneNumber}</small></span></td>
              <td>{c.subject}{c.transaction && <div className="mono muted">{c.transaction.reference}</div>}</td>
              <td><Badge value={c.priority} /></td>
              <td><Badge value={c.status} /></td>
              {showAssignee && <td>{c.assignedTo?.fullName ?? <span className="muted">Unassigned</span>}</td>}
              <td className="muted">{ago(c.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
