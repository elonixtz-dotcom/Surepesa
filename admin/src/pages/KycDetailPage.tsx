import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { day, humanize, when } from '../lib/format';
import { Badge, ErrorBox, Loading, PageHead, ReasonModal, toast, useApi } from '../components/ui';

interface KycDetail {
  id: string;
  status: string;
  fullName: string;
  dateOfBirth: string | null;
  idType: string;
  idNumber: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  customer: { id: string; name: string; phoneNumber: string | null; email: string | null; joinedAt: string } | null;
  documents: { id: string; type: string; mimeType: string; sizeBytes: number; sha256: string; url: string }[];
}

export function KycDetailPage() {
  const { id } = useParams();
  const { data: k, error, loading, reload } = useApi(() => api<KycDetail>(`/kyc/${id}`), [id]);
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);

  if (error != null) return <ErrorBox error={error} />;
  if (loading && !k) return <div className="card"><Loading rows={8} /></div>;
  if (!k) return null;

  async function approve() {
    setBusy(true);
    try {
      await api(`/kyc/${k!.id}/approve`, { method: 'POST', body: {} });
      toast('Identity approved. The customer can now send money.');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Approval failed', 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title={`KYC · ${k.fullName}`}
        subtitle={<><Badge value={k.status} /> Submitted {when(k.submittedAt)}</>}
        actions={k.status === 'PENDING' && (
          <>
            <button className="btn danger" onClick={() => setRejecting(true)} disabled={busy}>Reject</button>
            <button className="btn primary" onClick={approve} disabled={busy || k.documents.length === 0} title={k.documents.length === 0 ? 'No documents uploaded yet' : undefined}>
              Approve identity
            </button>
          </>
        )}
      />
      {k.status === 'PENDING' && k.documents.length === 0 && (
        <div className="alert warn" style={{ marginBottom: 16 }}>No documents have been uploaded. Approval is disabled until the customer uploads their ID.</div>
      )}
      <div className="grid cols-2">
        <div className="card card-pad">
          <h2 style={{ marginBottom: 12 }}>Declared details</h2>
          <dl className="kv">
            <dt>Full name</dt><dd>{k.fullName}</dd>
            <dt>Date of birth</dt><dd>{day(k.dateOfBirth)}</dd>
            <dt>ID type</dt><dd>{humanize(k.idType)}</dd>
            <dt>ID number</dt><dd className="mono">{k.idNumber}</dd>
            <dt>Customer</dt><dd>{k.customer ? <Link to={`/customers/${k.customer.id}`}>{k.customer.name}</Link> : '—'}</dd>
            <dt>Phone</dt><dd>{k.customer?.phoneNumber ?? '—'}</dd>
            <dt>Joined</dt><dd>{day(k.customer?.joinedAt)}</dd>
            {k.reviewedBy && (<><dt>Reviewed by</dt><dd>{k.reviewedBy} · {when(k.reviewedAt)}</dd></>)}
            {k.rejectionReason && (<><dt>Rejection reason</dt><dd>{k.rejectionReason}</dd></>)}
          </dl>
        </div>
        <div className="card card-pad">
          <h2 style={{ marginBottom: 12 }}>Documents</h2>
          {k.documents.length === 0 ? <p className="muted">Nothing uploaded.</p> : (
            <div className="grid cols-2">
              {k.documents.map((d) => (
                <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="note" style={{ color: 'inherit' }}>
                  {d.mimeType.startsWith('image/') ? (
                    <img src={d.url} alt={humanize(d.type)} style={{ width: '100%', height: 140, objectFit: 'contain', background: 'var(--surface)', borderRadius: 8 }} />
                  ) : <div className="empty">PDF</div>}
                  <div style={{ fontWeight: 600, marginTop: 6 }}>{humanize(d.type)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{(d.sizeBytes / 1024).toFixed(1)} KB · SHA-256 {d.sha256.slice(0, 12)}…</div>
                </a>
              ))}
            </div>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>Links expire after 5 minutes. Opening this page is recorded in the audit log.</p>
        </div>
      </div>
      {rejecting && (
        <ReasonModal
          title="Reject identity verification"
          description="The customer will be asked to submit again. Be specific so they can fix it."
          label="Reason"
          confirmLabel="Reject"
          danger
          onConfirm={async (reason) => {
            await api(`/kyc/${k.id}/reject`, { method: 'POST', body: { reason } });
            toast('Submission rejected.');
            reload();
          }}
          onClose={() => setRejecting(false)}
        />
      )}
    </>
  );
}
