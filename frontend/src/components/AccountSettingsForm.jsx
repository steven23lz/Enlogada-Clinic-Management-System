import React, { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Input } from './ui/input';
import { useAuth } from '../contexts/AuthContext';
import { User, Mail, Phone, KeyRound, CheckCircle, AlertCircle } from 'lucide-react';

// Shared account-settings form (contact info + change password), layout-agnostic so it can be
// embedded inside either DashboardLayout (Client) or SidebarLayout (staff/admin) without
// assuming a particular page shell. Extracted from ClientProfile.jsx, which was Client-only —
// every role should eventually get the same self-service account page, since the backend
// endpoints (PUT /auth/me, PUT /auth/change-password) already work for any authenticated role
// with zero changes needed; this is purely a missing frontend affordance for non-Client roles.
const AccountSettingsForm = ({ className = '' }) => {
  const { user, updateProfile, changePassword } = useAuth();

  const [accountData, setAccountData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    contactNumber: user?.contactNumber || ''
  });
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountSuccess, setAccountSuccess] = useState('');

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: ''
  });
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const handleSaveAccount = async (e) => {
    e.preventDefault();
    setAccountError('');
    setAccountSuccess('');

    if (!accountData.firstName.trim() || !accountData.lastName.trim()) {
      setAccountError('First name and last name are required.');
      return;
    }

    setIsSavingAccount(true);
    try {
      await updateProfile(accountData);
      setAccountSuccess('Your account details have been updated.');
    } catch (err) {
      setAccountError(typeof err === 'string' ? err : 'Failed to update account details.');
    } finally {
      setIsSavingAccount(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    const { currentPassword, newPassword, confirmNewPassword } = passwordData;
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setPasswordError('All password fields are required.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    setIsSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSuccess('Your password has been changed.');
      setPasswordData({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
    } catch (err) {
      setPasswordError(typeof err === 'string' ? err : 'Failed to change password.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Account Information */}
      <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
        <CardHeader className="bg-gray-50/70 border-b border-gray-100 py-3.5">
          <CardTitle className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
            <User className="w-4 h-4 text-[#769046]" />
            <span>Account Information</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSaveAccount} className="space-y-4">
            {accountError && (
              <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{accountError}</span>
              </div>
            )}
            {accountSuccess && (
              <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl flex items-center space-x-2">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>{accountSuccess}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-600 uppercase">First Name <span className="text-rose-600">*</span></label>
                <Input
                  value={accountData.firstName}
                  onChange={e => setAccountData({ ...accountData, firstName: e.target.value })}
                  disabled={isSavingAccount}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-600 uppercase">Last Name <span className="text-rose-600">*</span></label>
                <Input
                  value={accountData.lastName}
                  onChange={e => setAccountData({ ...accountData, lastName: e.target.value })}
                  disabled={isSavingAccount}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-600 uppercase flex items-center space-x-1.5">
                <Mail className="w-3.5 h-3.5" />
                <span>Email Address</span>
              </label>
              <Input value={user?.email || ''} disabled className="bg-gray-50 text-gray-500" />
              <p className="text-[11px] text-gray-400 m-0">Your email is your login and cannot be changed here.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-600 uppercase flex items-center space-x-1.5">
                <Phone className="w-3.5 h-3.5" />
                <span>Contact Number</span>
              </label>
              <Input
                placeholder="09171234567"
                value={accountData.contactNumber}
                onChange={e => setAccountData({ ...accountData, contactNumber: e.target.value })}
                disabled={isSavingAccount}
              />
            </div>

            <div className="flex justify-end pt-2 border-t border-gray-100">
              <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-white" disabled={isSavingAccount}>
                {isSavingAccount ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
        <CardHeader className="bg-gray-50/70 border-b border-gray-100 py-3.5">
          <CardTitle className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
            <KeyRound className="w-4 h-4 text-[#769046]" />
            <span>Change Password</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleChangePassword} className="space-y-4">
            {passwordError && (
              <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}
            {passwordSuccess && (
              <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl flex items-center space-x-2">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>{passwordSuccess}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-600 uppercase">Current Password <span className="text-rose-600">*</span></label>
              <Input
                type="password"
                value={passwordData.currentPassword}
                onChange={e => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                disabled={isSavingPassword}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-600 uppercase">New Password <span className="text-rose-600">*</span></label>
                <Input
                  type="password"
                  value={passwordData.newPassword}
                  onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                  disabled={isSavingPassword}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-600 uppercase">Confirm New Password <span className="text-rose-600">*</span></label>
                <Input
                  type="password"
                  value={passwordData.confirmNewPassword}
                  onChange={e => setPasswordData({ ...passwordData, confirmNewPassword: e.target.value })}
                  disabled={isSavingPassword}
                  required
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-400 m-0">Must be at least 8 characters.</p>

            <div className="flex justify-end pt-2 border-t border-gray-100">
              <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-white" disabled={isSavingPassword}>
                {isSavingPassword ? 'Saving...' : 'Change Password'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default AccountSettingsForm;
