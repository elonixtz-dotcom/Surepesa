import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, Page, Permission } from '../lib/api';
import { useAuth } from '../lib/auth';
import { initials } from '../lib/format';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  permission: Permission;
  countKey?: 'approvals' | 'kyc' | 'myCases';
}

const CONTROL: NavItem[] = [
  { to: '/overview', label: 'Overview', icon: '◧', permission: 'overview:view' },
  { to: '/kyc', label: 'KYC review', icon: '◎', permission: 'kyc:review', countKey: 'kyc' },
  { to: '/system', label: 'System health', icon: '♡', permission: 'system:view' },
  { to: '/audit', label: 'Audit log', icon: '☰', permission: 'audit:view' },
];

const SERVICE: NavItem[] = [
  { to: '/desk', label: 'Service desk', icon: '☎', permission: 'cases:manage' },
  { to: '/customers', label: 'Customers', icon: '☺', permission: 'customers:view' },
  { to: '/cases', label: 'Cases', icon: '▤', permission: 'cases:view', countKey: 'myCases' },
];

const MONEY: NavItem[] = [
  { to: '/transactions', label: 'Transactions', icon: '⇄', permission: 'transactions:view' },
  { to: '/approvals', label: 'Approvals', icon: '✓', permission: 'approvals:request', countKey: 'approvals' },
];

export function Layout() {
  const { staff, can, signOut } = useAuth();
  const location = useLocation();
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Badge counts refresh on navigation so queues stay current without polling.
  useEffect(() => {
    const load = async () => {
      const next: Record<string, number> = {};
      await Promise.all([
        can('approvals:decide') &&
          api<Page<unknown>>('/approvals?status=PENDING&pageSize=5').then((r) => (next.approvals = r.total)),
        can('kyc:review') && api<Page<unknown>>('/kyc?status=PENDING&pageSize=5').then((r) => (next.kyc = r.total)),
        can('cases:manage') && api<Page<unknown>>('/cases?mine=1&open=1&pageSize=5').then((r) => (next.myCases = r.total)),
      ]).catch(() => undefined);
      setCounts(next);
    };
    void load();
  }, [location.pathname, can]);

  const section = (title: string, items: NavItem[]) => {
    const visible = items.filter((i) => can(i.permission));
    if (!visible.length) return null;
    return (
      <>
        <div className="nav-section">{title}</div>
        {visible.map((i) => (
          <NavLink key={i.to} to={i.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <span aria-hidden="true" style={{ width: 18, textAlign: 'center' }}>{i.icon}</span>
            {i.label}
            {i.countKey && counts[i.countKey] ? <span className="count">{counts[i.countKey]}</span> : null}
          </NavLink>
        ))}
      </>
    );
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-mark" aria-hidden="true">₷</div>
          <div>
            SurePesa
            <small>Back Office</small>
          </div>
        </div>
        {section('System control', CONTROL)}
        {section('Customer service', SERVICE)}
        {section('Payments', MONEY)}
        <div className="sidebar-footer">
          <div className="avatar">{initials(staff!.fullName)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{staff!.fullName}</div>
            <div className="muted" style={{ fontSize: 12 }}>{staff!.roleLabel}</div>
          </div>
          <button className="btn sm" onClick={signOut} title="Sign out" aria-label="Sign out">⏻</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
