import React from 'react';
import SidebarLayout from '../components/SidebarLayout';
import PageHeader from '../components/ui/page-header';
import AccountSettingsForm from '../components/AccountSettingsForm';

// UI/UX Phase 1: every SidebarLayout-based role (Admin/SuperAdmin and all 5 operational
// roles) previously had no way to change their own password or contact info at all — the
// sidebar's user-info block wasn't even a button. Reached via that block regardless of role,
// reusing the same AccountSettingsForm Client's "My Account" page already uses; the backend
// endpoints it calls (PUT /auth/me, PUT /auth/change-password) already work for any
// authenticated role, so this is purely wiring up the missing frontend affordance.
//
// [1.79.0] It had no page heading, so it was the one staff screen with no <h1>: a screen reader
// user landed on "Profile" at level three with nothing above it. The heading is the name the
// sidebar's account button carries.
const StaffAccountSettings = ({ onSelectNav }) => (
  <SidebarLayout title="My Account" activeNav="account" onSelectNav={onSelectNav}>
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="My Account"
        description="Your name, contact details and password. A new password signs you out everywhere else."
      />
      <AccountSettingsForm />
    </div>
  </SidebarLayout>
);

export default StaffAccountSettings;
