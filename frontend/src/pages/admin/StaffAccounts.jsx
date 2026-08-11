import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { SearchInput } from '../../components/ui/search-input';
import Pagination from '../../components/ui/pagination';
import api from '../../config/api';
import { UserPlus, AlertCircle } from 'lucide-react';

// Module 12: staff account management, scoped to the 5 operational roles only (Admin/SuperAdmin
// account management is Module 13's explicit responsibility — see adminService.js's
// MANAGEABLE_ROLES, enforced server-side, not just hidden here).
const MANAGEABLE_ROLES = ['Receptionist', 'Cashier', 'Laboratory Staff', 'Ultrasound Staff', 'Xray Staff'];

// Visual Design Improvement Plan Phase V1: this list has no server-side pagination endpoint,
// so a client-side page size over an already-fetched, search-filtered array is proportionate —
// see VISUAL_IDENTITY.md §3a #11.
const PAGE_SIZE = 15;

const StaffAccounts = () => {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({ firstName: '', lastName: '', email: '', contactNumber: '', password: '', role: '' });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [statusTarget, setStatusTarget] = useState(null);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [statusError, setStatusError] = useState('');

  const fetchStaff = useCallback(async () => {
    try {
      const res = await api.get('/admin/staff');
      setStaff(res.data.data.staff || []);
    } catch (err) {
      console.error('Failed to fetch staff accounts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const handleOpenAdd = () => {
    setFormData({ firstName: '', lastName: '', email: '', contactNumber: '', password: '', role: '' });
    setFormError('');
    setShowAddModal(true);
  };

  const handleAddStaff = async (e) => {
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
      await api.post('/admin/staff', formData);
      setShowAddModal(false);
      fetchStaff();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to create staff account.');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmToggleStatus = async () => {
    if (!statusTarget) return;
    setTogglingStatus(true);
    setStatusError('');
    try {
      await api.patch(`/admin/staff/${statusTarget.id}/status`, { status: !statusTarget.status });
      setStatusTarget(null);
      fetchStaff();
    } catch (err) {
      setStatusError(err.response?.data?.message || 'Failed to update staff account status.');
    } finally {
      setTogglingStatus(false);
    }
  };

  const filteredStaff = staff.filter(s => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q) ||
      (s.roles?.[0] || '').toLowerCase().includes(q)
    );
  });
  const totalPages = Math.max(1, Math.ceil(filteredStaff.length / PAGE_SIZE));
  const pagedStaff = filteredStaff.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-100 shadow-xs">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900 m-0">Staff Accounts</h2>
          <p className="text-xs text-gray-500 m-0">
            Manage Receptionist, Cashier, and diagnostic staff accounts. Admin/SuperAdmin accounts are managed separately under RBAC administration.
          </p>
        </div>
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogTrigger asChild>
            <Button onClick={handleOpenAdd} className="bg-[#769046] hover:bg-[#657c3a] text-white flex items-center space-x-2 text-xs font-bold px-4 py-2 rounded-xl">
              <UserPlus className="w-4 h-4" />
              <span>Add Staff Account</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">Add New Staff Account</DialogTitle>
              <DialogDescription className="text-xs">Creates a login for a Receptionist, Cashier, or diagnostic staff member.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddStaff} className="space-y-4 pt-2">
              {formError && (
                <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
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
                <p className="text-[11px] text-gray-400 m-0">At least 8 characters.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 uppercase">Role</label>
                <Select value={formData.role} onValueChange={val => setFormData({ ...formData, role: val })}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {MANAGEABLE_ROLES.map(role => (
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
        <CardHeader className="border-b border-gray-100 py-4 px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-sm font-bold text-slate-800">
            {filteredStaff.length} Staff Account{filteredStaff.length === 1 ? '' : 's'}
            {search && <span className="text-xs font-normal text-gray-400"> of {staff.length} total</span>}
          </CardTitle>
          <SearchInput
            placeholder="Search name, email, or role..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            containerClassName="w-full sm:w-72"
          />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-gray-50/80">
              <TableRow>
                <TableHead className="text-[10px] font-bold uppercase py-3">Name</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Email</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Role</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Contact</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-xs text-gray-400">Loading staff accounts…</TableCell></TableRow>
              ) : pagedStaff.length > 0 ? (
                pagedStaff.map(s => (
                  <TableRow key={s.id} className="hover:bg-gray-50/50 transition-colors">
                    <TableCell className="py-3 font-bold text-xs text-slate-900 max-w-[180px] truncate" title={`${s.first_name} ${s.last_name}`}>{s.first_name} {s.last_name}</TableCell>
                    <TableCell className="py-3 text-xs text-gray-600 max-w-[220px] truncate" title={s.email}>{s.email}</TableCell>
                    <TableCell className="py-3 text-xs">
                      <Badge variant="outline" className="text-[10px] font-bold border-gray-200">{s.roles?.[0]}</Badge>
                    </TableCell>
                    <TableCell className="py-3 text-xs text-gray-500">{s.contact_number || 'N/A'}</TableCell>
                    <TableCell className="py-3">
                      <Badge
                        onClick={() => { setStatusError(''); setStatusTarget(s); }}
                        className={`cursor-pointer text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                          s.status ? 'bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200' : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
                        }`}
                      >
                        {s.status ? 'Active' : 'Deactivated'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-xs text-gray-400 italic">{search ? 'No staff accounts match your search.' : 'No staff accounts yet.'}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            totalLabel={`${filteredStaff.length} account${filteredStaff.length === 1 ? '' : 's'}`}
          />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!statusTarget}
        onOpenChange={(open) => { if (!open) { setStatusTarget(null); setStatusError(''); } }}
        title={statusTarget?.status ? 'Deactivate Staff Account' : 'Activate Staff Account'}
        description={statusTarget && `${statusTarget.status ? 'Deactivate' : 'Activate'} ${statusTarget.first_name} ${statusTarget.last_name}'s account? ${statusTarget.status ? 'They will no longer be able to log in.' : 'They will be able to log in again.'}`}
        confirmLabel={statusTarget?.status ? 'Deactivate' : 'Activate'}
        onConfirm={confirmToggleStatus}
        loading={togglingStatus}
        error={statusError}
      />
    </div>
  );
};

export default StaffAccounts;
