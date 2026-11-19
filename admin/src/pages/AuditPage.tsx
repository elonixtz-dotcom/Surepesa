import { useState } from 'react';
import { api, Page } from '../lib/api';
import { humanize, when } from '../lib/format';
import { ErrorBox, Loading, PageHead, Pager, useApi } from '../components/ui';

interface AuditItem {
  id: string;
  at: string;
  actorType: string;
  actor: string;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
}

const ACTIONS = ['', 'ADMIN_LOGIN', 'ADMIN_LOGIN_FAILED', 'CUSTOMER_VIEWED', 'USER_SUSPENDED', 'USER_REACTIVATED', 'KYC_VIEWED', 'KYC_APPROVED', 'KYC_REJECTED',
  'CASE_OPENED', 'CASE_UPDATED', 'REVERSAL_REQUESTED', 'REVERSAL_APPROVED', 'REVERSAL_REJECTED', 'TRANSACTION_REVERSED'];

/** Read-only, append-only record of who did what (SOP §13.47). */
export function AuditPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi(
    () => api<Page<AuditItem>>(`/audit-logs?page=${page}${action ? `&action=${action}` : ''}`),
    [page, action],
  );

  return (
    <>
      <PageHead
        title="Audit log"
        subtitle="Every privileged action and every view of customer data. Read-only."
        actions={
          <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action">
            {ACTIONS.map((a) => <option key={a} value={a}>{a ? humanize(a) : 'All actions'}</option>)}
          </select>
        }
      />
      <div className="card">
        {error != null && <div className="card-pad"><ErrorBox error={error} /></div>}
        {loading && !data ? <Loading /> : data && (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
                <tbody>
                  {data.items.map((l) => (
                    <tr key={l.id}>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{when(l.at)}</td>
                      <td>{l.actor}{l.actorRole && <div className="muted" style={{ fontSize: 12 }}>{humanize(l.actorRole)}</div>}</td>
                      <td><strong>{humanize(l.action)}</strong></td>
                      <td>{l.entityType}<div className="mono muted">{l.entityId?.slice(0, 8)}</div></td>
                      <td className="mono muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(l.after ?? '')}>
                        {l.after ? JSON.stringify(l.after) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
