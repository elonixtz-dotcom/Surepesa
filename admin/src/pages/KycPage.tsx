import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Page } from '../lib/api';
import { ago, humanize, when } from '../lib/format';
import { Badge, Empty, ErrorBox, Loading, PageHead, useApi } from '../components/ui';

interface KycItem {
  id: string;
  status: string;
  fullName: string;
  idType: string;
  idNumber: string;
  documents: number;
  customer: { id: string; name: string; phoneNumber: string | null } | null;
  submittedAt: string;
}

export function KycPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('PENDING');
  const { data, error, loading } = useApi(() => api<Page<KycItem>>(`/kyc?status=${status}`), [status]);

  return (
    <>
      <PageHead
        title="KYC review"
        subtitle="Oldest submissions first. Customers cannot send money until approved."
        actions={
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        }
      />
      <div className="card">
        {error != null && <div className="card-pad"><ErrorBox error={error} /></div>}
        {loading && !data ? <Loading /> : data && data.items.length === 0 ? <Empty>No {status.toLowerCase()} submissions.</Empty> : data && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Declared name</th><th>ID</th><th>Documents</th><th>Status</th><th>Submitted</th></tr></thead>
              <tbody>
                {data.items.map((k) => (
                  <tr key={k.id} className="clickable" onClick={() => navigate(`/kyc/${k.id}`)}>
                    <td><span className="party"><span>{k.customer?.name ?? '—'}</span><small>{k.customer?.phoneNumber}</small></span></td>
                    <td>{k.fullName}</td>
                    <td>{humanize(k.idType)}<div className="mono muted">{k.idNumber}</div></td>
                    <td>{k.documents === 0 ? <span className="badge warn">None uploaded</span> : k.documents}</td>
                    <td><Badge value={k.status} /></td>
                    <td className="muted" title={when(k.submittedAt)}>{ago(k.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
