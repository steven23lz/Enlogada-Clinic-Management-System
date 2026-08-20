import React from 'react';
import PageHeader from '../../components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ShieldCheck } from 'lucide-react';
import RoleMatrix from '../../components/admin/RoleMatrix';
import ElevatedAccountsPanel from '../../components/admin/ElevatedAccountsPanel';
import { useAccessControl } from '../../hooks/useAccessControl';
import { useElevatedAccounts } from '../../hooks/useElevatedAccounts';

/**
 * The two capabilities an Admin account deliberately does not have.
 *
 * This file used to hold both screens outright — two components of seventeen and eleven state
 * values each, plus this wrapper, in 774 lines. They are separate screens that happen to share a
 * tab strip, so they are separate files now, and their state is in a hook apiece.
 */
const SuperAdminManagement = () => {
  const access = useAccessControl();
  const elevated = useElevatedAccounts();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="SuperAdmin only"
        icon={ShieldCheck}
        title="Super Admin Management"
        description="RBAC administration and elevated account management — the two capabilities an Admin account deliberately does not have."
      />

      <Tabs defaultValue="matrix" className="w-full space-y-4">
        <TabsList>
          <TabsTrigger value="matrix">Role-Permission Matrix</TabsTrigger>
          <TabsTrigger value="accounts">Elevated Accounts</TabsTrigger>
        </TabsList>
        <TabsContent value="matrix" className="m-0">
          <RoleMatrix access={access} />
        </TabsContent>
        <TabsContent value="accounts" className="m-0">
          <ElevatedAccountsPanel elevated={elevated} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SuperAdminManagement;
