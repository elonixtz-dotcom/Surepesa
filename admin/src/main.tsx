import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth';
import { Permission } from './lib/api';
import { Layout } from './components/Layout';
import { ToastHost } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { ReportsPage } from './pages/ReportsPage';
import { SupportDeskPage } from './pages/SupportDeskPage';
import { CustomersPage } from './pages/CustomersPage';
import { CustomerDetailPage } from './pages/CustomerDetailPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { TransactionDetailPage } from './pages/TransactionDetailPage';
import { CasesPage } from './pages/CasesPage';
import { CaseDetailPage } from './pages/CaseDetailPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { KycPage } from './pages/KycPage';
import { KycDetailPage } from './pages/KycDetailPage';
import { SystemPage } from './pages/SystemPage';
import { AuditPage } from './pages/AuditPage';
import { RailsPage } from './pages/RailsPage';
import { FeesPage } from './pages/FeesPage';

function Guard({ permission, children }: { permission: Permission; children: JSX.Element }) {
  const { can } = useAuth();
  return can(permission) ? children : <div className="alert warn">Your role does not have access to this page.</div>;
}

/** Customer Service lands on their desk; everyone else on the controller overview. */
function Home() {
  const { can } = useAuth();
  return <Navigate to={can('overview:view') ? '/overview' : '/desk'} replace />;
}

function App() {
  const { staff, loading } = useAuth();
  if (loading) return <div className="login-page"><div className="skeleton" style={{ width: 240, height: 24 }} /></div>;
  if (!staff) return <LoginPage />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="overview" element={<Guard permission="overview:view"><OverviewPage /></Guard>} />
        <Route path="reports" element={<Guard permission="reports:view"><ReportsPage /></Guard>} />
        <Route path="desk" element={<Guard permission="cases:view"><SupportDeskPage /></Guard>} />
        <Route path="customers" element={<Guard permission="customers:view"><CustomersPage /></Guard>} />
        <Route path="customers/:id" element={<Guard permission="customers:view"><CustomerDetailPage /></Guard>} />
        <Route path="transactions" element={<Guard permission="transactions:view"><TransactionsPage /></Guard>} />
        <Route path="transactions/:id" element={<Guard permission="transactions:view"><TransactionDetailPage /></Guard>} />
        <Route path="cases" element={<Guard permission="cases:view"><CasesPage /></Guard>} />
        <Route path="cases/:id" element={<Guard permission="cases:view"><CaseDetailPage /></Guard>} />
        <Route path="approvals" element={<Guard permission="approvals:request"><ApprovalsPage /></Guard>} />
        <Route path="kyc" element={<Guard permission="kyc:review"><KycPage /></Guard>} />
        <Route path="kyc/:id" element={<Guard permission="kyc:review"><KycDetailPage /></Guard>} />
        <Route path="rails" element={<Guard permission="rails:manage"><RailsPage /></Guard>} />
        <Route path="fees" element={<Guard permission="fees:view"><FeesPage /></Guard>} />
        <Route path="system" element={<Guard permission="system:view"><SystemPage /></Guard>} />
        <Route path="audit" element={<Guard permission="audit:view"><AuditPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <ToastHost />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
