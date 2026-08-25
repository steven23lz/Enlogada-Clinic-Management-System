import React from 'react';
import PageHeader from '../../components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ShieldCheck } from 'lucide-react';
import RoleMatrix from '../../components/admin/RoleMatrix';
import ElevatedAccountsPanel from '../../components/admin/ElevatedAccountsPanel';
import PaymentMethodsPanel from '../../components/admin/PaymentMethodsPanel';
import PaymentMethodFormDialog from '../../components/admin/PaymentMethodFormDialog';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { useAccessControl } from '../../hooks/useAccessControl';
import { useElevatedAccounts } from '../../hooks/useElevatedAccounts';
import { usePaymentMethodAdmin } from '../../hooks/usePaymentMethodAdmin';

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
  const paymentMethods = usePaymentMethodAdmin();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="SuperAdmin only"
        icon={ShieldCheck}
        title="Super Admin Management"
        description="RBAC administration, elevated accounts, and the clinic's own payment accounts — the capabilities an Admin account deliberately does not have."
      />

      <Tabs defaultValue="matrix" className="w-full space-y-4">
        <TabsList>
          <TabsTrigger value="matrix">Role-Permission Matrix</TabsTrigger>
          <TabsTrigger value="accounts">Elevated Accounts</TabsTrigger>
          <TabsTrigger value="payments">Payment Methods</TabsTrigger>
        </TabsList>
        <TabsContent value="matrix" className="m-0">
          <RoleMatrix access={access} />
        </TabsContent>
        <TabsContent value="accounts" className="m-0">
          <ElevatedAccountsPanel elevated={elevated} />
        </TabsContent>
        <TabsContent value="payments" className="m-0">
          <PaymentMethodsPanel paymentMethods={paymentMethods} />
        </TabsContent>
      </Tabs>

      <PaymentMethodFormDialog paymentMethods={paymentMethods} />
      <ConfirmDialog
        open={!!paymentMethods.confirmTarget}
        onOpenChange={(open) => { if (!open) paymentMethods.dismissToggle(); }}
        title={paymentMethods.confirmTarget?.is_active ? 'Hide from patients' : 'Offer to patients'}
        description={paymentMethods.confirmTarget && (
          paymentMethods.confirmTarget.is_active
            ? `Stop offering "${paymentMethods.confirmTarget.label}"? Patients will no longer be shown this account. Payments already verified against it are untouched.`
            : `Offer "${paymentMethods.confirmTarget.label}" again? Patients will be shown this account when they pay online.`
        )}
        confirmLabel={paymentMethods.confirmTarget?.is_active ? 'Hide it' : 'Offer it'}
        onConfirm={paymentMethods.confirmToggle}
        loading={paymentMethods.toggling}
        error={paymentMethods.toggleError}
      />
    </div>
  );
};

export default SuperAdminManagement;
