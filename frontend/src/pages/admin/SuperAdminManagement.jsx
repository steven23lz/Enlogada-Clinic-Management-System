import React, { useState, useEffect, useCallback } from 'react';
import { Panel, PanelHeader, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import Pagination from '../../components/ui/pagination';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../config/api';
import { UserPlus, ShieldCheck, Edit, AlertCircle } from 'lucide-react';

const ELEVATED_ROLES = ['Admin', 'SuperAdmin'];

// UI/UX Modernization Phase 4: both tables below are fetched in one shot with no server-side
// pagination endpoint, so a client-side page size is proportionate (VISUAL_IDENTITY.md §3a #11).
const PAGE_SIZE = 15;

// --- Role-Permission Matrix -------------------------------------------------------------
const RoleMatrix = () => {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [rolePermissions, setRolePermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [editingRole, setEditingRole] = useState(null);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchMatrix = useCallback(async () => {
    try {
      const res = await api.get('/rbac/matrix');
      setRoles(res.data.data.roles || []);
      setPermissions(res.data.data.permissions || []);
      setRolePermissions(res.data.data.rolePermissions || {});
    } catch (err) {
      console.error('Failed to fetch RBAC matrix:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatrix();
  }, [fetchMatrix]);

  const permissionsByModule = permissions.reduce((acc, p) => {
    if (!acc[p.module]) acc[p.module] = [];
    acc[p.module].push(p);
    return acc;
  }, {});

  const totalPages = Math.max(1, Math.ceil(roles.length / PAGE_SIZE));
  const pagedRoles = roles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleOpenEdit = (role) => {
    setSaveError('');
    const current = rolePermissions[role.name] || [];
    const ids = new Set(permissions.filter(p => current.includes(p.name)).map(p => p.id));
    setCheckedIds(ids);
    setEditingRole(role);
  };

  const togglePermission = (permId) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(permId)) next.delete(permId); else next.add(permId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!editingRole) return;
    setSaving(true);
    setSaveError('');
    try {
      await api.put(`/rbac/roles/${editingRole.id}/permissions`, { permissionIds: Array.from(checkedIds) });
      setEditingRole(null);
      fetchMatrix();
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Failed to update role permissions.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* This banner used to read "Advisory only — not yet enforced", and the note here explained
          that authorizePermissions was wired to zero routes so revoking a permission changed
          nothing. Both were honest at the time and are now the opposite of true: permissions gate
          46 API routes and the sidebar, and Admin no longer bypasses them. */}
      <div
        role="status"
        className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-fine leading-relaxed text-brand-800 ring-1 ring-inset ring-brand-200"
      >
        <ShieldCheck className="mt-px h-4 w-4 flex-shrink-0 text-brand-600" />
        <span>
          <strong className="font-bold">Live — these permissions are enforced.</strong> Unticking
          one immediately stops that role calling the endpoints behind it, and removes the matching
          screen from their sidebar (within a minute, without them signing out). Two things are
          deliberately <em>not</em> governed here: a role&apos;s structural boundary — no permission
          can put a Client on a diagnostic worklist — and <strong>SuperAdmin</strong>, which
          bypasses these checks so a misconfigured matrix can always be repaired.
        </span>
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Roles & Their Assigned Permissions"
          description="Ticking a permission grants it to that role's API access and sidebar immediately"
          icon={ShieldCheck}
        />
        <PanelBody flush>
          <Table>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <SkeletonRows rows={5} columns={3} />
              ) : (
                pagedRoles.map(role => (
                  <TableRow key={role.id} className="align-top">
                    <TableCell className="whitespace-nowrap font-semibold text-slate-900">{role.name}</TableCell>
                    <TableCell>
                      <div className="flex max-w-2xl flex-wrap gap-1">
                        {(rolePermissions[role.name] || []).length > 0 ? (
                          (rolePermissions[role.name] || []).map(permName => (
                            <Badge key={permName} variant="outline" className="font-mono text-micro text-slate-600">{permName}</Badge>
                          ))
                        ) : (
                          <span className="text-fine text-slate-400">No permissions assigned</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button onClick={() => handleOpenEdit(role)} variant="outline" size="xs">
                        <Edit className="h-3 w-3" />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </PanelBody>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalLabel={`${roles.length} total`} />
      </Panel>

      <Dialog open={!!editingRole} onOpenChange={(open) => { if (!open) setEditingRole(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Permissions — {editingRole?.name}</DialogTitle>
            <DialogDescription>Changes take effect immediately.</DialogDescription>
          </DialogHeader>

          {saveError && (
            <div role="alert" className="alert alert-error">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="max-h-80 overflow-y-auto space-y-4 pr-1">
            {Object.entries(permissionsByModule).map(([module, perms]) => (
              <div key={module} className="space-y-1.5">
                <span className="field-label">{module}</span>
                <div className="space-y-1">
                  {perms.map(p => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#e6ebf1] p-2 transition-colors hover:border-brand-300 hover:bg-brand-50/50">
                      <input
                        type="checkbox"
                        checked={checkedIds.has(p.id)}
                        onChange={() => togglePermission(p.id)}
                        className="h-4 w-4 rounded accent-[#769046]"
                      />
                      <span>
                        <span className="block font-mono text-fine font-semibold text-slate-900">{p.name}</span>
                        {p.description && <span className="block text-fine text-slate-500">{p.description}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 border-t border-[#e6ebf1] pt-3">
            <Button type="button" variant="outline" onClick={() => setEditingRole(null)} disabled={saving}>Cancel</Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// --- Elevated Accounts -------------------------------------------------------------------
const ElevatedAccounts = () => {
  const { user: currentUser } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', contactNumber: '', password: '', role: '' });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [statusTarget, setStatusTarget] = useState(null);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [statusError, setStatusError] = useState('');

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await api.get('/superadmin/accounts');
      setAccounts(res.data.data.accounts || []);
    } catch (err) {
      console.error('Failed to fetch elevated accounts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleOpenAdd = () => {
    setFormData({ firstName: '', lastName: '', email: '', contactNumber: '', password: '', role: '' });
    setFormError('');
    setShowAddModal(true);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!formData.firstName.trim() || !formData.lastName.trim() || !formData.email.trim() || !formData.password || !formData.role) {
      setFormError('First name, last name, email, password, and role are required.');
      return;
    }
    if (formData.password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/superadmin/accounts', formData);
      setShowAddModal(false);
      fetchAccounts();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to create elevated account.');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmToggleStatus = async () => {
    if (!statusTarget) return;
    setTogglingStatus(true);
    setStatusError('');
    try {
      await api.patch(`/superadmin/accounts/${statusTarget.id}/status`, { status: !statusTarget.status });
      setStatusTarget(null);
      fetchAccounts();
    } catch (err) {
      setStatusError(err.response?.data?.message || 'Failed to update account status.');
    } finally {
      setTogglingStatus(false);
    }
  };

  // Pin the signed-in account to the top. The server returns elevated accounts newest-first
  // (userRepository.findStaffUsers → ORDER BY u.created_at DESC), so the founding SuperAdmin
  // is the OLDEST row and drifts further down every time an elevated account is added — on a
  // paginated list it eventually falls off page 1 entirely. That is the one row this screen
  // must always show, since it is the row the panel's own warning is about ("You cannot
  // deactivate your own account"). Sorted here rather than in the repository because
  // findStaffUsers is shared with the Staff Accounts screen, which has no "self" to pin.
  const sortedAccounts = React.useMemo(() => {
    if (!currentUser) return accounts;
    return [...accounts].sort((a, b) => (b.id === currentUser.id) - (a.id === currentUser.id));
  }, [accounts, currentUser]);

  const totalPages = Math.max(1, Math.ceil(sortedAccounts.length / PAGE_SIZE));
  const pagedAccounts = sortedAccounts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 text-[15px] font-bold tracking-tight text-slate-900">Elevated Accounts (Admin / SuperAdmin)</h3>
          <p className="m-0 mt-1 text-fine leading-relaxed text-slate-500">You cannot deactivate your own account, to prevent locking the clinic out of elevated administration.</p>
        </div>
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogTrigger asChild>
            <Button onClick={handleOpenAdd}>
              <UserPlus className="h-4 w-4" />
              Add Elevated Account
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add Elevated Account</DialogTitle>
              <DialogDescription>Creates an Admin or SuperAdmin login. Grant this power carefully.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4 pt-2">
              {formError && (
                <div role="alert" className="alert alert-error">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="field-label">First Name</label>
                  <Input value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} disabled={submitting} required />
                </div>
                <div className="space-y-1">
                  <label className="field-label">Last Name</label>
                  <Input value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} disabled={submitting} required />
                </div>
              </div>
              <div className="space-y-1">
                <label className="field-label">Email</label>
                <Input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} disabled={submitting} required />
              </div>
              <div className="space-y-1">
                <label className="field-label">Contact Number</label>
                <Input value={formData.contactNumber} onChange={e => setFormData({ ...formData, contactNumber: e.target.value })} disabled={submitting} />
              </div>
              <div className="space-y-1">
                <label className="field-label">Temporary Password</label>
                <Input type="password" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} disabled={submitting} required />
                <p className="text-fine text-gray-400 m-0">At least 8 characters.</p>
              </div>
              <div className="space-y-1">
                <label className="field-label">Role</label>
                <Select value={formData.role} onValueChange={val => setFormData({ ...formData, role: val })}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ELEVATED_ROLES.map(role => (
                      <SelectItem key={role} value={role}>{role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end space-x-2 pt-2 border-t border-[#e6ebf1]">
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)} disabled={submitting}>Cancel</Button>
                <Button type="submit" className="font-bold" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create Account'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Panel className="overflow-hidden">
        <PanelBody flush>
          <Table>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <SkeletonRows rows={4} columns={4} />
              ) : pagedAccounts.length > 0 ? (
                pagedAccounts.map(a => {
                  const isSelf = currentUser?.id === a.id;
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-semibold text-slate-900">
                        {a.first_name} {a.last_name} {isSelf && <span className="font-normal text-slate-400">(you)</span>}
                      </TableCell>
                      <TableCell className="text-slate-500">{a.email}</TableCell>
                      <TableCell><Badge variant="outline" className="text-slate-600">{a.roles?.[0]}</Badge></TableCell>
                      <TableCell>
                        {/* A real button, and genuinely disabled for your own row rather than
                            just dimmed — the previous version was a clickable <div> whose
                            "cannot deactivate yourself" rule lived only in an early return. */}
                        <button
                          type="button"
                          disabled={isSelf}
                          onClick={() => { setStatusError(''); setStatusTarget(a); }}
                          title={isSelf ? 'You cannot deactivate your own account' : a.status ? 'Deactivate this account' : 'Activate this account'}
                          className={`rounded-md border-0 px-2 py-0.5 text-fine font-semibold leading-5 ring-1 ring-inset transition-colors ${
                            isSelf ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                          } ${
                            a.status
                              ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 enabled:hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-600 ring-slate-200 enabled:hover:bg-slate-200'
                          }`}
                        >
                          {a.status ? 'Active' : 'Deactivated'}
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-10 text-center text-fine text-slate-500">No elevated accounts yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </PanelBody>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalLabel={`${accounts.length} total`} />
      </Panel>

      <ConfirmDialog
        open={!!statusTarget}
        onOpenChange={(open) => { if (!open) { setStatusTarget(null); setStatusError(''); } }}
        title={statusTarget?.status ? 'Deactivate Elevated Account' : 'Activate Elevated Account'}
        description={statusTarget && `${statusTarget.status ? 'Deactivate' : 'Activate'} ${statusTarget.first_name} ${statusTarget.last_name}'s ${statusTarget.roles?.[0]} account?`}
        confirmLabel={statusTarget?.status ? 'Deactivate' : 'Activate'}
        onConfirm={confirmToggleStatus}
        loading={togglingStatus}
        error={statusError}
      />
    </div>
  );
};

const SuperAdminManagement = () => {
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
          <RoleMatrix />
        </TabsContent>
        <TabsContent value="accounts" className="m-0">
          <ElevatedAccounts />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SuperAdminManagement;
