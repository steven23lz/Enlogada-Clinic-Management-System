import React, { useState, useEffect, useCallback } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { Card, CardContent } from '../components/ui/card';
import { DollarSign, Shield, FileText, UserCheck, Info } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../config/api';
import StaffAccounts from './admin/StaffAccounts';
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
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Services Catalog</span>
              <div className="text-2xl font-extrabold text-slate-900">{loading ? '…' : catalogCount}</div>
              <span className="text-[11px] text-[#769046] font-bold">Lab, X-Ray, Ultrasound &amp; more</span>
            </div>
            <div className="w-11 h-11 bg-[#769046]/10 text-[#769046] rounded-2xl flex items-center justify-center"><FileText className="w-5 h-5" /></div>
          </CardContent>
        </Card>

        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Today's Revenue</span>
              <div className="text-2xl font-extrabold text-slate-900">{loading ? '…' : `₱${todayRevenue.toFixed(2)}`}</div>
              <span className="text-[11px] text-gray-400 font-bold">See Reports for trend</span>
            </div>
            <div className="w-11 h-11 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center"><DollarSign className="w-5 h-5" /></div>
          </CardContent>
        </Card>

        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Clinic Operational Roles</span>
              <div className="text-2xl font-extrabold text-slate-900">{loading ? '…' : `${roleCount} Roles`}</div>
              <span className="text-[11px] text-indigo-600 font-bold">RBAC Enforced</span>
            </div>
            <div className="w-11 h-11 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center"><Shield className="w-5 h-5" /></div>
          </CardContent>
        </Card>

        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white">
          <CardContent className="p-5 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">HMO Partners</span>
              <div className="text-2xl font-extrabold text-slate-900">1CoopHealth</div>
              <span className="text-[11px] text-purple-600 font-bold">Active Accreditation</span>
            </div>
            <div className="w-11 h-11 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center"><UserCheck className="w-5 h-5" /></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const ServiceRequestsPlaceholder = () => (
  <div className="bg-white p-10 rounded-2xl border border-dashed border-gray-200 text-center space-y-3">
    <Info className="w-8 h-8 text-gray-400 mx-auto" />
    <h3 className="text-sm font-bold text-slate-700 m-0">Not Yet Available</h3>
    <p className="text-xs text-gray-500 max-w-md mx-auto m-0">
      Service &amp; HMO request oversight belongs to a future module (Test and Service Request) and hasn't been built yet.
    </p>
  </div>
);

const AdminDashboard = ({ activeNav = 'dashboard', onSelectNav }) => {
  const { user } = useAuth();

  const renderContent = () => {
    switch (activeNav) {
      case 'staff':
        return <StaffAccounts />;
      case 'service-requests':
        return <ServiceRequestsPlaceholder />;
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
