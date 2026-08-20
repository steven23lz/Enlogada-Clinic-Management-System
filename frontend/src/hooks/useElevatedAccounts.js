import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../config/api';
import { useAuth } from '../contexts/AuthContext';

// Fetched in one shot with no server-side pagination endpoint, so a client-side page size over
// the array already in hand is proportionate (VISUAL_IDENTITY.md §3a #11).
export const ELEVATED_PAGE_SIZE = 15;

/**
 * The Admin and SuperAdmin accounts — listing them, creating one, and deactivating one.
 *
 * The signed-in account is pinned to the top. The server returns elevated accounts newest-first
 * (`userRepository.findStaffUsers` → `ORDER BY u.created_at DESC`), so the founding SuperAdmin is
 * the OLDEST row and drifts further down every time an elevated account is added — on a paginated
 * list it eventually falls off page 1 entirely. That is the one row this screen must always show,
 * because it is the row the panel's own warning is about ("You cannot deactivate your own
 * account"). Sorted here rather than in the repository because `findStaffUsers` is shared with
 * the Staff Accounts screen, which has no "self" to pin.
 */
export function useElevatedAccounts() {
  const { user: currentUser } = useAuth();

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', contactNumber: '', password: '', role: '' });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [statusTarget, setStatusTarget] = useState(null);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [statusError, setStatusError] = useState('');

  const reload = useCallback(async () => {
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
    reload();
  }, [reload]);

  const openAdd = () => {
    setForm({ firstName: '', lastName: '', email: '', contactNumber: '', password: '', role: '' });
    setFormError('');
    setShowAdd(true);
  };

  const closeAdd = () => {
    if (submitting) return;
    setShowAdd(false);
  };

  const submitAdd = async (e) => {
    e?.preventDefault();
    setFormError('');
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim() || !form.password || !form.role) {
      setFormError('First name, last name, email, password, and role are required.');
      return;
    }
    if (form.password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/superadmin/accounts', form);
      setShowAdd(false);
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to create elevated account.');
      return;
    } finally {
      setSubmitting(false);
    }
    // The account exists; re-reading the list is follow-up and must not report it as failed.
    reload();
  };

  const requestStatusChange = (account) => {
    setStatusError('');
    setStatusTarget(account);
  };

  const dismissStatusChange = () => {
    if (togglingStatus) return;
    setStatusTarget(null);
  };

  const confirmStatusChange = async () => {
    if (!statusTarget) return;
    setTogglingStatus(true);
    setStatusError('');
    try {
      await api.patch(`/superadmin/accounts/${statusTarget.id}/status`, { status: !statusTarget.status });
      setStatusTarget(null);
    } catch (err) {
      setStatusError(err.response?.data?.message || 'Failed to update account status.');
      return;
    } finally {
      setTogglingStatus(false);
    }
    reload();
  };

  const sorted = useMemo(() => {
    if (!currentUser) return accounts;
    return [...accounts].sort((a, b) => (b.id === currentUser.id) - (a.id === currentUser.id));
  }, [accounts, currentUser]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / ELEVATED_PAGE_SIZE));

  return {
    currentUser,
    accounts: sorted,
    paged: sorted.slice((page - 1) * ELEVATED_PAGE_SIZE, page * ELEVATED_PAGE_SIZE),
    loading, page, setPage, totalPages, total: sorted.length,
    showAdd, openAdd, closeAdd, form, setForm, formError, submitting, submitAdd,
    statusTarget, togglingStatus, statusError,
    requestStatusChange, dismissStatusChange, confirmStatusChange,
    reload,
  };
}

export default useElevatedAccounts;
