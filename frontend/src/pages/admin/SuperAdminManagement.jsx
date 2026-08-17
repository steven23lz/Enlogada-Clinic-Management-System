import React, { useState, useEffect, useCallback } from 'react';
import { Panel, PanelHeader, PanelBody, PanelFooter } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import EmptyState from '../../components/ui/empty-state';
import { SearchInput } from '../../components/ui/search-input';
import { SkeletonRows, SkeletonList } from '../../components/ui/skeleton';
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
import { UserPlus, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';

const ELEVATED_ROLES = ['Admin', 'SuperAdmin'];

// UI/UX Modernization Phase 4: both tables below are fetched in one shot with no server-side
// pagination endpoint, so a client-side page size is proportionate (VISUAL_IDENTITY.md §3a #11).
const PAGE_SIZE = 15;

// --- Access Control: by role, or by the individual person ---------------------------------
//
// The old screen was a table of roles with an Edit button per row. It answered exactly one
// question — "what does the Cashier role get?" — and every other question the clinic actually
// asks had no home:
//
//   "Can Doc Lab cover the till on Saturday?"        -> only by editing every cashier's access
//   "Why can this person issue refunds?"             -> unanswerable from the screen
//   "Who can open X-Ray records?"                    -> unanswerable from the screen
//
// Two modes now. **Role** edits the template, as before. **Person** edits one named account: the
// same permission list, but each row shows where its current state came from — inherited from a
// role, or an exception someone made for this person — and toggling one writes the smallest
// override that produces the state you asked for, rather than copying the whole template onto
// the account. That distinction is what keeps a later change to the Cashier role still reaching
// everyone who was never given an exception.
const OVERRIDE_TONE = {
  grant: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  revoke: 'bg-rose-50 text-rose-800 ring-rose-200',
};

const RoleMatrix = () => {
  const [permissions, setPermissions] = useState([]);
  const [roles, setRoles] = useState([]);
  const [rolePermissions, setRolePermissions] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // 'role' | 'person', and which one. Kept as ids in state so a refetch after saving re-selects
  // the same subject rather than dumping the reader back to the top of the list.
  const [mode, setMode] = useState('role');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  // The working copy. `roleDraft` is a plain set of permission ids; `personDraft` is a map of
  // permissionId -> 'grant' | 'revoke', holding only the exceptions.
  const [roleDraft, setRoleDraft] = useState(new Set());
  const [personDraft, setPersonDraft] = useState({});
  const [departmentDraft, setDepartmentDraft] = useState(new Set());

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [search, setSearch] = useState('');

  const fetchMatrix = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get('/rbac/matrix');
      const d = res.data.data;
      setPermissions(d.permissions || []);
      setRoles(d.roles || []);
      setRolePermissions(d.rolePermissions || {});
      setAccounts(d.accounts || []);
      setCategories(d.categories || []);
      return d;
    } catch (err) {
      console.error('Failed to fetch RBAC matrix:', err);
      setLoadError('Could not load the access control matrix.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatrix();
  }, [fetchMatrix]);

  const selectedRole = roles.find((r) => String(r.id) === String(selectedRoleId)) || null;
  const selectedUser = accounts.find((a) => String(a.id) === String(selectedUserId)) || null;

  // Loading a subject resets the draft to whatever that subject currently has. Done in an effect
  // keyed on the selection rather than in the change handler, so a refetch after saving also
  // re-syncs the draft — otherwise the screen keeps showing your unsaved edits as if they landed.
  useEffect(() => {
    if (mode !== 'role' || !selectedRole) return;
    const current = rolePermissions[selectedRole.name] || [];
    setRoleDraft(new Set(permissions.filter((p) => current.includes(p.name)).map((p) => p.id)));
  }, [mode, selectedRole, rolePermissions, permissions]);

  useEffect(() => {
    if (mode !== 'person' || !selectedUser) return;
    const draft = {};
    (selectedUser.overrides || []).forEach((o) => {
      draft[o.permissionId] = o.effect;
    });
    setPersonDraft(draft);
    setDepartmentDraft(
      new Set(categories.filter((c) => (selectedUser.grantedDepartments || []).includes(c.name)).map((c) => c.id))
    );
  }, [mode, selectedUser, categories]);

  const permissionsByModule = permissions.reduce((acc, p) => {
    if (!acc[p.module]) acc[p.module] = [];
    acc[p.module].push(p);
    return acc;
  }, {});

  const matchesSearch = (p) =>
    !search.trim() ||
    p.name.toLowerCase().includes(search.trim().toLowerCase()) ||
    (p.description || '').toLowerCase().includes(search.trim().toLowerCase());

  // For a person: what their roles alone would give them.
  const roleGrantedNames = new Set(selectedUser?.rolePermissions || []);

  /** Whether the person currently ends up with this permission, draft applied. */
  const personHas = (permission) => {
    const override = personDraft[permission.id];
    if (override === 'grant') return true;
    if (override === 'revoke') return false;
    return roleGrantedNames.has(permission.name);
  };

  /**
   * Toggling writes the *smallest* override that produces the state asked for.
   *
   * If the new state matches what the roles already give, the override is deleted rather than
   * written as a redundant grant. That is what keeps a later edit to the Cashier role still
   * reaching this person: an account pinned with an explicit grant for every permission would
   * silently stop tracking its own role.
   */
  const togglePerson = (permission) => {
    const next = !personHas(permission);
    setPersonDraft((prev) => {
      const draft = { ...prev };
      if (next === roleGrantedNames.has(permission.name)) {
        delete draft[permission.id];
      } else {
        draft[permission.id] = next ? 'grant' : 'revoke';
      }
      return draft;
    });
  };

  const toggleRole = (permission) => {
    setRoleDraft((prev) => {
      const next = new Set(prev);
      if (next.has(permission.id)) next.delete(permission.id);
      else next.add(permission.id);
      return next;
    });
  };

  const toggleDepartment = (categoryId) => {
    setDepartmentDraft((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  const overrideCount = Object.keys(personDraft).length;
  const subjectChosen = mode === 'role' ? Boolean(selectedRole) : Boolean(selectedUser);

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      if (mode === 'role') {
        await api.put(`/rbac/roles/${selectedRole.id}/permissions`, {
          permissionIds: Array.from(roleDraft),
        });
      } else {
        await api.put(`/rbac/users/${selectedUser.id}/overrides`, {
          overrides: Object.entries(personDraft).map(([permissionId, effect]) => ({
            permissionId: Number(permissionId),
            effect,
          })),
        });
        await api.put(`/rbac/users/${selectedUser.id}/departments`, {
          categoryIds: Array.from(departmentDraft),
        });
      }
      await fetchMatrix();
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Could not save. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  const resetToRoles = () => {
    setPersonDraft({});
    setDepartmentDraft(new Set());
  };

  return (
    <div className="space-y-4">
      {/* This banner used to read "Advisory only — not yet enforced", and the note here explained
          that authorizePermissions was wired to zero routes so revoking a permission changed
          nothing. Both were honest at the time and are now the opposite of true: permissions gate
          48 API routes and the sidebar, and Admin no longer bypasses them. */}
      <div
        role="status"
        className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-fine leading-relaxed text-brand-800 ring-1 ring-inset ring-brand-200"
      >
        <ShieldCheck className="mt-px h-4 w-4 flex-shrink-0 text-brand-600" />
        <span>
          <strong className="font-bold">Live — these permissions are enforced.</strong> A change
          reaches the person&apos;s API access immediately and their sidebar within a minute, with
          no need for them to sign out. The one thing not governed here is the staff/patient
          boundary: no tick can put a patient on a worklist. <strong>SuperAdmin</strong> bypasses
          every check, so a matrix misconfigured into locking everyone out can always be repaired.
        </span>
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Access Control"
          description="Edit the template a role gives everyone, or the exceptions for one person"
          icon={ShieldCheck}
          actions={
            <div className="inline-flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
              {[
                { value: 'role', label: 'By Role' },
                { value: 'person', label: 'By Person' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => { setMode(option.value); setSaveError(''); setSavedAt(null); }}
                  className={`cursor-pointer rounded-[7px] border-0 px-3 py-1.5 text-fine font-semibold transition-colors ${
                    mode === option.value
                      ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgb(15_23_42_/_0.08)]'
                      : 'bg-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          }
        />

        {/* Subject picker + permission search. Both dropdowns, because the alternative — the old
            table of every role with an Edit button — does not scale to a staff list and gave no
            way to jump straight to the person you are being asked about. */}
        <div className="flex flex-wrap items-end gap-3 border-b border-[#e6ebf1] bg-slate-50/70 p-4">
          {mode === 'role' ? (
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="rbac-role" className="field-label m-0">Role</label>
              <Select value={String(selectedRoleId)} onValueChange={setSelectedRoleId}>
                <SelectTrigger id="rbac-role" className="w-[240px]">
                  <SelectValue placeholder="Choose a role…" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={String(role.id)}>
                      {role.name} · {(rolePermissions[role.name] || []).length} permissions
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="rbac-person" className="field-label m-0">Staff member</label>
              <Select value={String(selectedUserId)} onValueChange={setSelectedUserId}>
                <SelectTrigger id="rbac-person" className="w-[300px]">
                  <SelectValue placeholder="Choose a staff member…" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={String(account.id)}>
                      {account.firstName} {account.lastName} · {account.roles.join(', ')}
                      {account.overrides?.length ? ` · ${account.overrides.length} exception${account.overrides.length === 1 ? '' : 's'}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {subjectChosen && (
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label htmlFor="rbac-search" className="field-label m-0">Find a permission</label>
              <SearchInput
                id="rbac-search"
                placeholder="e.g. billing, results, refund…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                containerClassName="max-w-xs"
              />
            </div>
          )}
        </div>

        <PanelBody>
          {loading ? (
            <SkeletonList rows={5} />
          ) : loadError ? (
            <EmptyState
              tone="error"
              title="Could not load access control"
              description={loadError}
              action={<Button variant="outline" size="sm" onClick={fetchMatrix}>Try again</Button>}
            />
          ) : !subjectChosen ? (
            <EmptyState
              icon={ShieldCheck}
              title={mode === 'role' ? 'Choose a role to edit' : 'Choose a staff member'}
              description={
                mode === 'role'
                  ? 'A role is the template everyone holding it inherits. Changing it affects every one of them.'
                  : 'An exception applies to this person only, and survives later changes to their role.'
              }
            />
          ) : (
            <div className="space-y-5">
              {mode === 'person' && (
                <>
                  {/* What this person ends up with, stated before the checkboxes. Someone opening
                      this screen is usually answering a question about a person, not editing —
                      and the answer should not require reading 27 checkboxes. */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-[#e6ebf1] p-3">
                      <span className="field-label">Roles held</span>
                      <div className="flex flex-wrap gap-1">
                        {selectedUser.roles.map((r) => (
                          <Badge key={r} variant="outline" className="text-slate-600">{r}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[#e6ebf1] p-3">
                      <span className="field-label">Effective permissions</span>
                      <span className="text-[15px] font-bold tabular-nums text-slate-900">
                        {selectedUser.effectivePermissions.length}
                        <span className="ml-1 text-fine font-normal text-slate-500">of {permissions.length}</span>
                      </span>
                    </div>
                    <div className={`rounded-lg border p-3 ${overrideCount ? 'border-amber-200 bg-amber-50/60' : 'border-[#e6ebf1]'}`}>
                      <span className="field-label">Exceptions</span>
                      <span className="flex items-center gap-2">
                        <span className="text-[15px] font-bold tabular-nums text-slate-900">{overrideCount}</span>
                        {overrideCount > 0 && (
                          <button
                            type="button"
                            onClick={resetToRoles}
                            className="cursor-pointer border-0 bg-transparent p-0 text-fine font-semibold text-brand-700 underline underline-offset-2"
                          >
                            Reset to role defaults
                          </button>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Departments. A separate axis from permissions: `results:write` says they may
                      write a result, this says whose. Roles imply their own and are shown ticked
                      and disabled — removing one means removing the role. */}
                  <div className="rounded-lg border border-[#e6ebf1] p-3">
                    <span className="field-label">Department access</span>
                    <p className="m-0 mb-2 text-fine leading-relaxed text-slate-500">
                      Which modalities&apos; patients and results this person may open. Ticks from their
                      role are fixed; add one to cover another room without giving them a second role.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {categories.map((category) => {
                        const fromRole = (selectedUser.roleDepartments || []).includes(category.name);
                        const checked = fromRole || departmentDraft.has(category.id);
                        return (
                          <label
                            key={category.id}
                            title={fromRole ? `Comes with the ${selectedUser.roles.join('/')} role` : undefined}
                            className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-fine font-medium ${
                              fromRole
                                ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500'
                                : 'cursor-pointer border-[#e6ebf1] hover:border-brand-300 hover:bg-brand-50/50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded accent-[#769046]"
                              checked={checked}
                              disabled={fromRole}
                              onChange={() => toggleDepartment(category.id)}
                            />
                            {category.name}
                            {fromRole && <span className="text-micro text-slate-400">via role</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {Object.entries(permissionsByModule).map(([module, modulePermissions]) => {
                const visible = modulePermissions.filter(matchesSearch);
                if (visible.length === 0) return null;
                return (
                  <div key={module}>
                    <span className="field-label">{module}</span>
                    <div className="space-y-1">
                      {visible.map((permission) => {
                        const checked = mode === 'role' ? roleDraft.has(permission.id) : personHas(permission);
                        const override = mode === 'person' ? personDraft[permission.id] : null;
                        const fromRole = mode === 'person' && roleGrantedNames.has(permission.name);
                        return (
                          <label
                            key={permission.id}
                            className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-2 transition-colors ${
                              override
                                ? 'border-amber-200 bg-amber-50/50'
                                : 'border-[#e6ebf1] hover:border-brand-300 hover:bg-brand-50/50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded accent-[#769046]"
                              checked={checked}
                              onChange={() =>
                                mode === 'role' ? toggleRole(permission) : togglePerson(permission)
                              }
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-mono text-fine font-semibold text-slate-900">{permission.name}</span>
                              {permission.description && (
                                <span className="block text-fine text-slate-500">{permission.description}</span>
                              )}
                            </span>
                            {/* Where this state came from. Without it, a ticked box is ambiguous
                                between "the role gives this" and "someone decided this for them",
                                and only one of those is a thing you should feel free to change. */}
                            {mode === 'person' && (
                              override ? (
                                <span className={`flex-shrink-0 rounded-md px-1.5 py-0.5 text-micro font-semibold uppercase leading-5 ring-1 ring-inset ${OVERRIDE_TONE[override]}`}>
                                  {override === 'grant' ? 'Granted' : 'Revoked'}
                                </span>
                              ) : fromRole ? (
                                <span className="flex-shrink-0 text-micro font-medium text-slate-400">via role</span>
                              ) : null
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </PanelBody>

        {subjectChosen && !loading && (
          <PanelFooter>
            <span className="text-fine text-slate-500">
              {mode === 'role'
                ? `Applies to everyone holding ${selectedRole?.name}.`
                : `Applies to ${selectedUser?.firstName} ${selectedUser?.lastName} only.`}
            </span>
            <span className="flex items-center gap-3">
              {saveError && (
                <span role="alert" className="text-fine font-semibold text-rose-700">{saveError}</span>
              )}
              {savedAt && !saveError && (
                <span role="status" className="inline-flex items-center gap-1 text-fine font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Saved
                </span>
              )}
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </span>
          </PanelFooter>
        )}
      </Panel>
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
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={accounts.length} pageSize={PAGE_SIZE} />
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
