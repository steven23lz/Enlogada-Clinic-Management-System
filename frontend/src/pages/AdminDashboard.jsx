import React, { useState, useEffect, useCallback } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import MetricCard from '../components/ui/metric-card';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { StatusBadge } from '../components/ui/status-badge';
import RevenueTrendChart from '../components/charts/RevenueTrendChart';
import {
  DollarSign, Shield, FileText, UserCheck, Users, CreditCard, BarChart3, ClipboardList, ArrowRight
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../config/api';
import { formatCurrency } from '../lib/currency';
import StaffAccounts from './admin/StaffAccounts';
import ServiceRequests from './admin/ServiceRequests';
import CashierMonitoring from './admin/CashierMonitoring';
import AppointmentsOversight from './admin/AppointmentsOversight';
import PatientRecordsOversight from './admin/PatientRecordsOversight';
import ReportsOverview from './admin/ReportsOverview';
import SuperAdminManagement from './admin/SuperAdminManagement';
import ActivityLog from './admin/ActivityLog';

const NAV_TITLES = {
  dashboard: 'Management Console',
  staff: 'Staff Accounts',
  'service-requests': 'Service Requests',
  'cashier-monitoring': 'Cashier Monitoring',
  'appointments-list': 'Appointments Oversight',
  'patient-records': 'Patient Records Oversight',
  reports: 'Clinic Reports',
  activity: 'Activity Log',
  superadmin: 'Super Admin Management',
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// Visual Design Improvement Plan Phase V2: the overview previously ended at the stat row,
// leaving the rest of the page blank (see the plan's Section 08, finding 01). Revenue Trend and
// Recent Activity below reuse GET /reports/summary and GET /visits/history — both already built
// for ReportsOverview.jsx / Receptionist's Visit History — rather than adding new backend surface.
const QUICK_ACTIONS = [
  { id: 'staff', label: 'Staff Accounts', icon: Users },
  { id: 'cashier-monitoring', label: 'Cashier Monitoring', icon: CreditCard },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'service-requests', label: 'Service Requests', icon: ClipboardList },
];

// The 'dashboard' overview's own summary cards — kept lightweight and separate from
// ReportsOverview.jsx (the dedicated 'reports' section), which goes further (yesterday
// comparison, payment method breakdown). Both independently fetch real data; neither
// hardcodes numbers, unlike this component's previous version (see TRACEABILITY.md).
const DashboardOverview = ({ onSelectNav }) => {
  const { user } = useAuth();
  const [catalogCount, setCatalogCount] = useState(0);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [roleCount, setRoleCount] = useState(0);
  const [hmoPartnerCount, setHmoPartnerCount] = useState(0);
  const [revenueTrend, setRevenueTrend] = useState([]);
  const [recentVisits, setRecentVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [secondaryError, setSecondaryError] = useState(false);

  const fetchOverview = useCallback(async () => {
    try {
      const today = todayStr();
      const [testsRes, txRes, rbacRes, hmoRes] = await Promise.all([
        api.get('/tests'),
        api.get('/payments/transactions', { params: { startDate: today, endDate: today } }),
        api.get('/rbac/matrix'),
        api.get('/hmo/providers'),
      ]);
      setCatalogCount((testsRes.data.data.tests || []).length);
      setTodayRevenue((txRes.data.data.transactions || []).reduce((s, t) => s + parseFloat(t.amount || 0), 0));
      setRoleCount((rbacRes.data.data.roles || []).length);
      setHmoPartnerCount((hmoRes.data.data.providers || []).filter(p => p.is_active).length);
    } catch (err) {
      console.error('Failed to fetch dashboard overview:', err);
    } finally {
      setLoading(false);
    }

    try {
      const weekAgo = daysAgoStr(6);
      const today = todayStr();
      const [summaryRes, visitsRes] = await Promise.all([
        api.get('/reports/summary', { params: { startDate: weekAgo, endDate: today } }),
        api.get('/visits/history', { params: { startDate: weekAgo, endDate: today } }),
      ]);
      setRevenueTrend(summaryRes.data.data.report?.revenueTrend || []);
      setRecentVisits((visitsRes.data.data.visits || []).slice(0, 6));
    } catch (err) {
      console.error('Failed to fetch dashboard activity/trend:', err);
      setSecondaryError(true);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  return (
    <div className="space-y-6">
      <div className="bg-[#192534] text-white p-6 rounded-3xl shadow-md">
        <span className="text-meta font-bold text-[#769046] uppercase tracking-wider block">Clinic Administration</span>
        <h2 className="text-2xl font-bold tracking-tight m-0 text-white">System Command Center</h2>
        <p className="text-xs text-gray-300 m-0 mt-1">
          Welcome back, {user?.firstName || 'Admin'}. Use the sidebar to manage staff, monitor cashiers, and oversee appointments and patient records.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard
          label="Total Services Catalog"
          value={loading ? '…' : catalogCount}
          caption="Lab, X-Ray, Ultrasound & more"
          icon={FileText}
          tone="green"
        />
        <MetricCard
          label="Today's Revenue"
          value={loading ? '…' : formatCurrency(todayRevenue)}
          caption="See Reports for trend"
          captionTone="slate"
          icon={DollarSign}
          tone="emerald"
        />
        <MetricCard
          label="Clinic Operational Roles"
          value={loading ? '…' : `${roleCount} Roles`}
          caption="RBAC Enforced"
          icon={Shield}
          tone="indigo"
        />
        <MetricCard
          label="HMO Partners"
          value={loading ? '…' : `${hmoPartnerCount} Partner${hmoPartnerCount === 1 ? '' : 's'}`}
          caption="Accredited Providers"
          icon={UserCheck}
          tone="purple"
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_ACTIONS.map(action => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              onClick={() => onSelectNav && onSelectNav(action.id)}
              className="flex items-center justify-between bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-xs hover:shadow-md hover:border-[#769046]/30 transition-all cursor-pointer group text-left"
            >
              <span className="flex items-center space-x-2.5">
                <span className="w-8 h-8 rounded-xl bg-[#769046]/10 text-[#769046] flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4" />
                </span>
                <span className="text-xs font-bold text-slate-800">{action.label}</span>
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-[#769046] group-hover:translate-x-0.5 transition-all flex-shrink-0" />
            </button>
          );
        })}
      </div>

      {secondaryError && (
        <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl p-3">
          Couldn't load the revenue trend or recent activity below. <button onClick={fetchOverview} className="underline font-bold cursor-pointer border-0 bg-transparent p-0">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-gray-100 py-4 px-6 space-y-0.5">
            <CardTitle className="text-sm font-bold text-slate-800">Revenue Trend</CardTitle>
            <p className="text-fine text-gray-500 m-0">Last 7 days</p>
          </CardHeader>
          <CardContent className="p-5">
            {loading ? (
              <p className="text-xs text-gray-400 text-center py-6">Loading…</p>
            ) : revenueTrend.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-6">No paid transactions in the last 7 days.</p>
            ) : (
              <RevenueTrendChart data={revenueTrend} />
            )}
          </CardContent>
        </Card>

        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-gray-100 py-4 px-6">
            <CardTitle className="text-sm font-bold text-slate-800">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="text-xs text-gray-400 text-center py-8">Loading…</p>
            ) : recentVisits.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-8">No visits in the last 7 days.</p>
            ) : (
              <ul className="divide-y divide-gray-100 m-0 p-0 list-none">
                {recentVisits.map(v => (
                  <li key={v.id} className="flex items-center justify-between px-6 py-3 gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 m-0 truncate">{v.first_name} {v.last_name}</p>
                      <p className="text-fine text-gray-400 m-0">{v.visit_type} &middot; {new Date(v.created_at).toLocaleString()}</p>
                    </div>
                    <StatusBadge status={v.visit_status} className="flex-shrink-0" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const AdminDashboard = ({ activeNav = 'dashboard', onSelectNav }) => {
  const { user } = useAuth();

  const renderContent = () => {
    switch (activeNav) {
      case 'staff':
        return <StaffAccounts />;
      case 'service-requests':
        return <ServiceRequests />;
      case 'cashier-monitoring':
        return <CashierMonitoring />;
      case 'appointments-list':
        return <AppointmentsOversight />;
      case 'patient-records':
        return <PatientRecordsOversight />;
      case 'reports':
        return <ReportsOverview />;
      case 'activity':
        return <ActivityLog />;
      case 'superadmin':
        // Backend endpoints already enforce SuperAdmin-only; this just avoids rendering a
        // confusing broken tab for an Admin whose activeNav somehow ended up here (the nav
        // item itself is already hidden from Admin in SidebarLayout).
        return user?.roles?.includes('SuperAdmin') ? <SuperAdminManagement /> : <DashboardOverview onSelectNav={onSelectNav} />;
      default:
        return <DashboardOverview onSelectNav={onSelectNav} />;
    }
  };

  return (
    <SidebarLayout title={NAV_TITLES[activeNav] || 'Management Console'} activeNav={activeNav} onSelectNav={onSelectNav}>
      {renderContent()}
    </SidebarLayout>
  );
};

export default AdminDashboard;
