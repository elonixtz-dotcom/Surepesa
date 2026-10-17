import { useState } from 'react';
import { api, CaseSummary, Page } from '../lib/api';
import { Empty, ErrorBox, Loading, PageHead, Pager, useApi } from '../components/ui';
import { CaseTable } from './SupportDeskPage';

const VIEWS = [
  { key: 'open', label: 'All open', query: 'open=1' },
  { key: 'mine', label: 'Assigned to me', query: 'mine=1&open=1' },
  { key: 'ESCALATED', label: 'Escalated', query: 'status=ESCALATED' },
  { key: 'RESOLVED', label: 'Resolved', query: 'status=RESOLVED' },
  { key: 'all', label: 'Everything', query: '' },
];

export function CasesPage() {
  const [view, setView] = useState('open');
  const [page, setPage] = useState(1);
  const query = VIEWS.find((v) => v.key === view)!.query;
  const { data, error, loading } = useApi(() => api<Page<CaseSummary>>(`/cases?page=${page}&${query}`), [view, page]);

  return (
    <>
      <PageHead
        title="Cases"
        subtitle="Customer complaints and queries, most urgent first."
        actions={
          <div className="toolbar" role="tablist">
            {VIEWS.map((v) => (
              <button key={v.key} role="tab" aria-selected={view === v.key} className={`btn sm${view === v.key ? ' primary' : ''}`} onClick={() => { setView(v.key); setPage(1); }}>
                {v.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="card">
        {error != null && <div className="card-pad"><ErrorBox error={error} /></div>}
        {loading && !data ? <Loading /> : data && data.items.length === 0 ? <Empty>No cases in this view.</Empty> : data && (
          <>
            <CaseTable items={data.items} showAssignee />
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
