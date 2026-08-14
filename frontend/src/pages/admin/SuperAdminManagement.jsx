import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
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
import { UserPlus, ShieldCheck, Edit, AlertCircle, Info } from 'lucide-react';

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
      {/* This matrix records intent, not enforcement, and says so rather than letting an admin
          believe otherwise. authorizePermissions (backend/src/middlewares/auth.js) is wired to
          zero of the API's 83 routes — access is decided by role name alone — so revoking a
          permission here saves and displays correctly while changing nothing about what the role
          can actually do. Silently implying otherwise is worse than not having the screen: it
          invites someone to "remove" access and walk away believing they did. */}
      <div
        role="status"
        className="flex items-start space-x-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-fine text-amber-900"
      >
        <Info className="w-4 h-4 flex-shrink-0 mt-px" />
        <span>
          <strong className="font-bold">Advisory only — not yet enforced.</strong> These
          assignments are recorded and reportable, but the API currently authorises requests by
          role, not by permission. Changing a permission here does <strong>not</strong> change
          what a role can do. To actually restrict access today, change the role assigned to the
          user under <em>Elevated Accounts</em> or <em>Staff Accounts</em>.
        </span>
      </div>

      <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
        <CardHeader className="border-b border-gray-100 py-4 px-6">
          <CardTitle className="text-sm font-bold text-slate-800">Roles &amp; Their Assigned Permissions</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50/80">
              <TableRow>
                <TableHead className="text-meta font-bold uppercase py-3">Role</TableHead>
                <TableHead className="text-meta font-bold uppercase py-3">Permissions</TableHead>
                <TableHead className="text-meta font-bold uppercase py-3 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={3} className="text-center py-6 text-xs text-gray-400">Loading role matrix…</TableCell></TableRow>
              ) : (
                pagedRoles.map(role => (
                  <TableRow key={role.id} className="hover:bg-gray-50/50 transition-colors align-top">
                    <TableCell className="py-3 font-bold text-xs text-slate-900 whitespace-nowrap">{role.name}</TableCell>
                    <TableCell className="py-3">
                      <div className="flex flex-wrap gap-1 max-w-2xl">
                        {(rolePermissions[role.name] || []).length > 0 ? (
                          (rolePermissions[role.name] || []).map(permName => (
                            <Badge key={permName} variant="outline" className="text-meta font-semibold border-gray-200">{permName}</Badge>
                          ))
                        ) : (
                          <span className="text-fine text-gray-400 italic">No permissions assigned</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      <Button
                        onClick={() => handleOpenEdit(role)}
                        variant="outline"
                        className="text-fine font-bold border-gray-200 hover:bg-[#769046] hover:text-white rounded-lg py-1 px-2.5"
                      >
                        <Edit className="w-3.5 h-3.5 mr-1" />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalLabel={`${roles.length} total`} />
      </Card>

      <Dialog open={!!editingRole} onOpenChange={(open) => { if (!open) setEditingRole(null); }}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">Edit Permissions — {editingRole?.name}</DialogTitle>
            <DialogDescription className="text-xs">Changes take effect immediately.</DialogDescription>
          </DialogHeader>

          {saveError && (
            <div role="alert" className="p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-bold rounded-xl flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="max-h-80 overflow-y-auto space-y-4 pr-1">
            {Object.entries(permissionsByModule).map(([module, perms]) => (
              <div key={module} className="space-y-1.5">
                <span className="text-meta font-bold text-gray-400 uppercase tracking-wider block">{module}</span>
                <div className="space-y-1">
                  {perms.map(p => (
                    <label key={p.id} className="flex items-center space-x-2.5 p-2 bg-gray-50/70 hover:bg-gray-50 rounded-lg cursor-pointer border border-gray-100">
                      <input
                        type="checkbox"
                        checked={checkedIds.has(p.id)}
                        onChange={() => togglePermission(p.id)}
                        className="rounded text-[#769046] focus:ring-[#769046]"
                      />
                      <div className="text-xs">
                        <span className="font-bold text-gray-800 block">{p.name}</span>
                        {p.description && <span className="text-fine text-gray-500">{p.description}</span>}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
            <Button type="button" variant="outline" onClick={() => setEditingRole(null)} disabled={saving}>Cancel</Button>
            <Button type="button" onClick={handleSave} className="bg-[#769046] hover:bg-[#657c3a] text-white font-bold" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-100 shadow-xs">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-slate-900 m-0">Elevated Accounts (Admin / SuperAdmin)</h3>
          <p className="text-xs text-gray-500 m-0">You cannot deactivate your own account, to prevent locking the clinic out of elevated administration.</p>
        </div>
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogTrigger asChild>
            <Button onClick={handleOpenAdd} className="bg-[#769046] hover:bg-[#657c3a] text-white flex items-center space-x-2 text-xs font-bold px-4 py-2 rounded-xl">
              <UserPlus className="w-4 h-4" />
              <span>Add Elevated Account</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">Add Elevated Account</DialogTitle>
              <DialogDescription className="text-xs">Creates an Admin or SuperAdmin login. Grant this power carefully.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4 pt-2">
              {formError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-bold rounded-xl flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-600 uppercase">First Name</label>
                  <Input value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} disabled={submitting} required />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-600 uppercase">Last Name</label>
                  <Input value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} disabled={submitting} required />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 uppercase">Email</label>
                <Input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} disabled={submitting} required />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 uppercase">Contact Number</label>
                <Input value={formData.contactNumber} onChange={e => setFormData({ ...formData, contactNumber: e.target.value })} disabled={submitting} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 uppercase">Temporary Password</label>
                <Input type="password" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} disabled={submitting} required />
                <p className="text-fine text-gray-400 m-0">At least 8 characters.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 uppercase">Role</label>
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
              <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)} disabled={submitting}>Cancel</Button>
                <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-white font-bold" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create Account'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-gray-50/80">
              <TableRow>
                <TableHead className="text-meta font-bold uppercase py-3">Name</TableHead>
                <TableHead className="text-meta font-bold uppercase py-3">Email</TableHead>
                <TableHead className="text-meta font-bold uppercase py-3">Role</TableHead>
                <TableHead className="text-meta font-bold uppercase py-3">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-6 text-xs text-gray-400">Loading elevated accounts…</TableCell></TableRow>
              ) : pagedAccounts.length > 0 ? (
                pagedAccounts.map(a => {
                  const isSelf = currentUser?.id === a.id;
                  return (
                    <TableRow key={a.id} className="hover:bg-gray-50/50 transition-colors">
                      <TableCell className="py-3 font-bold text-xs text-slate-900">
                        {a.first_name} {a.last_name} {isSelf && <span className="text-meta text-gray-400 font-normal">(you)</span>}
                      </TableCell>
                      <TableCell className="py-3 text-xs text-gray-600">{a.email}</TableCell>
                      <TableCell className="py-3 text-xs"><Badge variant="outline" className="text-meta font-bold border-gray-200">{a.roles?.[0]}</Badge></TableCell>
                      <TableCell className="py-3">
                        <Badge
                          onClick={() => { if (isSelf) return; setStatusError(''); setStatusTarget(a); }}
                          className={`text-meta font-bold px-2.5 py-0.5 rounded-full ${isSelf ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${
                            a.status ? 'bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200' : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
                          }`}
                        >
                          {a.status ? 'Active' : 'Deactivated'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow><TableCell colSpan={4} className="text-center py-6 text-xs text-gray-400 italic">No elevated accounts yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalLabel={`${accounts.length} total`} />
      </Card>

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
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs space-y-1">
        <h2 className="text-xl font-bold text-slate-900 m-0 flex items-center space-x-2">
          <ShieldCheck className="w-5 h-5 text-[#769046]" />
          <span>Super Admin Management</span>
        </h2>
        <p className="text-xs text-gray-500 m-0">RBAC administration and elevated account management — capabilities beyond what an Admin account can do.</p>
      </div>

      <Tabs defaultValue="matrix" className="w-full space-y-4">
        <TabsList className="bg-gray-100 p-1 rounded-xl">
          <TabsTrigger value="matrix" className="rounded-lg text-xs font-bold px-4 py-1.5">Role-Permission Matrix</TabsTrigger>
          <TabsTrigger value="accounts" className="rounded-lg text-xs font-bold px-4 py-1.5">Elevated Accounts</TabsTrigger>
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
