import React, { useState, useEffect, useCallback } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import MetricCard from '../components/ui/metric-card';
import { DollarSign, Shield, FileText, UserCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../config/api';
import StaffAccounts from './admin/StaffAccounts';
import ServiceRequests from './admin/ServiceRequests';
import CashierMonitoring from './admin/CashierMonitoring';
import AppointmentsOversight from './admin/AppointmentsOversight';
import PatientRecordsOversight from './admin/PatientRecordsOversight';
import ReportsOverview from './admin/ReportsOverview';
import SuperAdminManagement from './admin/SuperAdminManagement';

const NAV_TITLES = {
  dashboard: 'Management Console',
  staff: 'Staff Accounts',
  'service-requests': 'Service Requests',
  'cashier-monitoring': 'Cashier Monitoring',
  'appointments-list': 'Appointments Oversight',
  'patient-records': 'Patient Records Oversight',
  reports: 'Clinic Reports',
  superadmin: 'Super Admin Management',
};

const todayStr = () => new Date().toISOString().slice(0, 10);

// The 'dashboard' overview's own summary cards — kept lightweight and separate from
// ReportsOverview.jsx (the dedicated 'reports' section), which goes further (yesterday
// comparison, payment method breakdown). Both independently fetch real data; neither
// hardcodes numbers, unlike this component's previous version (see TRACEABILITY.md).
const DashboardOverview = () => {
  const { user } = useAuth();
  const [catalogCount, setCatalogCount] = useState(0);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [roleCount, setRoleCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    try {
      const today = todayStr();
      const [testsRes, txRes, rbacRes] = await Promise.all([
        api.get('/tests'),
        api.get('/payments/transactions', { params: { startDate: today, endDate: today } }),
        api.get('/rbac/matrix'),
      ]);
      setCatalogCount((testsRes.data.data.tests || []).length);
      setTodayRevenue((txRes.data.data.transactions || []).reduce((s, t) => s + parseFloat(t.amount || 0), 0));
      setRoleCount((rbacRes.data.data.roles || []).length);
    } catch (err) {
      console.error('Failed to fetch dashboard overview:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  return (
    <div className="space-y-6">
      <div className="bg-[#192534] text-white p-6 rounded-3xl shadow-md">
        <span className="text-[10px] font-bold text-[#769046] uppercase tracking-wider block">Clinic Administration</span>
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
          value={loading ? '…' : `₱${todayRevenue.toFixed(2)}`}
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
          value="1CoopHealth"
          caption="Active Accreditation"
          icon={UserCheck}
          tone="purple"
        />
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
      case 'superadmin':
        // Backend endpoints already enforce SuperAdmin-only; this just avoids rendering a
        // confusing broken tab for an Admin whose activeNav somehow ended up here (the nav
        // item itself is already hidden from Admin in SidebarLayout).
        return user?.roles?.includes('SuperAdmin') ? <SuperAdminManagement /> : <DashboardOverview />;
      default:
        return <DashboardOverview />;
    }
  };

  return (
    <SidebarLayout title={NAV_TITLES[activeNav] || 'Management Console'} activeNav={activeNav} onSelectNav={onSelectNav}>
      {renderContent()}
    </SidebarLayout>
  );
};

export default AdminDashboard;
