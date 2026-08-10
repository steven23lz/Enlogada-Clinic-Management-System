import React from 'react';
import DashboardLayout from '../components/DashboardLayout';
import AccountSettingsForm from '../components/AccountSettingsForm';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

// Module 5: Profile — a client's own account settings (contact info, password,
// read-only view of account type). Distinct from Module 4 (Patient Management),
// which covers the `patients` records a client manages, not the `users` account itself.
// The form itself (Account Information + Change Password) now lives in the shared,
// layout-agnostic AccountSettingsForm component — this page supplies the Client-specific
// shell (back button, header) and the Account Type sidebar card.
//
// UI/UX Phase 3: dropped the raw resource:action permission-string badges that used to sit
// below the role badge here — confirmed not a security issue (a caller only ever sees their
// own JWT-derived roles/permissions), but raw RBAC strings like "appointments:create" are
// internal implementation detail that only confused a non-technical Client. The role badge
// alone already answers "what kind of account is this."
const ClientProfile = ({ onNavigate }) => {
  const { user } = useAuth();

  const roles = user?.roles || [];

  return (
    <DashboardLayout onNavigate={onNavigate} activeTab="account">
      <div className="flex flex-col space-y-6">

        <div className="flex items-center space-x-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onNavigate?.('dashboard')}
            className="h-9 w-9 p-0 rounded-xl border-gray-200 text-gray-500 hover:text-[#769046] hover:border-[#769046]"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 m-0">My Account</h1>
            <p className="text-xs text-gray-500 m-0">Manage your contact details, password, and view your assigned role.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left column: editable settings */}
          <div className="lg:col-span-2">
            <AccountSettingsForm />
          </div>

          {/* Right column: read-only role/permissions */}
          <div className="space-y-6">
            <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
              <CardHeader className="bg-gray-50/70 border-b border-gray-100 py-3.5">
                <CardTitle className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-[#769046]" />
                  <span>Account Type</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-1.5">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Assigned Role(s)</span>
                <div className="flex flex-wrap gap-1.5">
                  {roles.length > 0 ? roles.map(role => (
                    <Badge key={role} className="bg-[#769046]/10 text-[#769046] text-[11px] font-bold px-2.5 py-1 rounded-full border-0">
                      {role}
                    </Badge>
                  )) : (
                    <span className="text-xs text-gray-400 italic">No role assigned</span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-100 bg-[#192534] text-white rounded-2xl overflow-hidden p-5 space-y-2 shadow-sm">
              <div className="flex items-center space-x-2 text-[#769046]">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="font-bold text-sm text-white m-0">Account Security</h3>
              </div>
              <p className="text-gray-300 text-xs leading-relaxed m-0">
                Never share your password. If you suspect unauthorized access to your account, change your password immediately.
              </p>
            </Card>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
};

export default ClientProfile;
