import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';
import { toastSuccess } from '../lib/toast';

/**
 * Logging an HMO claim against a test, and watching the ones already filed.
 *
 * The two halves belong together because filing a claim changes the pending list — the
 * receptionist who just logged one expects to see it appear, and a list that does not refresh
 * looks like the claim was lost.
 *
 * The pending list is read-only here [UI/UX Modernization Phase 10]. `GET /hmo/requests` has
 * always been authorized for Receptionist, but nothing on this dashboard called it, so pending
 * requests were invisible unless someone already knew to look at Admin's Service Requests page.
 * Deciding a claim stays where it lives — an Admin or SuperAdmin approves or refuses; reception
 * only raises it.
 *
 * @param {() => void} onLogged  fired after a claim is filed, for whatever else must re-read
 */
export function useHmoLogging({ onLogged } = {}) {
  const [open, setOpen] = useState(false);
  const [visitTest, setVisitTest] = useState(null);
  // [1.161.0] The visit it came from: a card usually covers more than one test, and the claim may
  // need the doctor's name, which the server asked for and this dialog had no box for.
  const [visit, setVisit] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [physician, setPhysician] = useState('');
  const [physicianPrc, setPhysicianPrc] = useState('');
  const [providerId, setProviderId] = useState('');
  const [approvalCode, setApprovalCode] = useState('');
  const [memberNumber, setMemberNumber] = useState('');
  const [error, setError] = useState('');

  const [pending, setPending] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(true);

  const loadPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      const res = await api.get('/hmo/requests', { params: { status: 'Pending' } });
      setPending(res.data.data.requests || []);
    } catch (err) {
      console.error('Failed to fetch pending HMO requests:', err);
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  const openFor = (test, ofVisit = null) => {
    setVisitTest(test);
    setVisit(ofVisit);
    setSelectedIds([test.id]);
    setPhysician('');
    setPhysicianPrc('');
    setProviderId('');
    setApprovalCode('');
    setError('');
    setOpen(true);
  };

  const close = () => setOpen(false);

  // A test may join this claim unless one is already waiting on it or approved it.
  const claimable = (visit?.tests || []).filter((t) => !['Pending', 'Approved'].includes(t.hmo_status));
  const toggleTest = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selectAll = () => setSelectedIds(claimable.map((t) => t.id));
  const needsPhysician = Boolean(visit) && !visit.referring_physician && !visit.doctor_request_file_path;

  const submit = async (e) => {
    e?.preventDefault();
    setError('');

    // Only the provider is required. The LOA code is genuinely optional — reception logs the
    // claim, and an Admin issues the code on approval. The message here used to name a field
    // this check never looked at.
    if (!visitTest || !providerId) {
      setError('Choose the HMO provider before logging the claim.');
      return;
    }
    if (selectedIds.length === 0) {
      setError('Tick at least one test for this claim.');
      return;
    }
    if (needsPhysician && !physician.trim()) {
      setError('Give the requesting doctor\'s name: the HMO issues its LOA against it.');
      return;
    }

    try {
      await api.post('/hmo/request', {
        hmoProviderId: parseInt(providerId, 10),
        approvalCode,
        memberNumber,
        visitTestIds: selectedIds,
        ...(needsPhysician ? { referringPhysician: physician.trim(), referringPhysicianPrc: physicianPrc.trim() } : {}),
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to log HMO authorization');
      return;
    }

    // Filed. Everything below is follow-up and must not be able to report it as failed.
    toastSuccess('HMO Pre-authorization logged successfully!');
    setOpen(false);
    setMemberNumber('');
    setApprovalCode('');
    loadPending();
    onLogged?.();
  };

  return {
    open, visitTest, visit,
    claimable, selectedIds, toggleTest, selectAll,
    needsPhysician, physician, setPhysician, physicianPrc, setPhysicianPrc,
    providerId, setProviderId,
    approvalCode, setApprovalCode,
    memberNumber, setMemberNumber,
    error,
    pending, pendingLoading,
    openFor, close, submit, reloadPending: loadPending,
  };
}

export default useHmoLogging;
