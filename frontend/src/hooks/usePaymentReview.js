import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';
import { usePolling } from './usePolling';
import { toastSuccess, toastError } from '../lib/toast';

/**
 * The cashier's queue of online payments awaiting a human check. [1.48.0]
 *
 * A patient pays into the clinic's own GCash or bank account and uploads the confirmation. Nobody
 * is standing at the counter, so nothing prompts a cashier to look — which is why this polls like
 * the billing queue does, and why submitting one raises a notification.
 *
 * ── The comparison this screen exists to make ───────────────────────────────────────────────
 *
 * Approving bills the visit's REAL total, not the amount the patient typed. So approving a
 * screenshot that says ₱50 against a ₱1,450 visit records ₱1,450 as received and the drawer is
 * short ₱1,400 with nothing anywhere to explain it. The cashier is the only control on that, so
 * the queue carries both figures and the panel puts them side by side.
 */
export function usePaymentReview({ enabled = true } = {}) {
  const [submissions, setSubmissions] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [acting, setActing] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/payment-submissions/pending');
      setSubmissions(res.data.data.submissions || []);
      setError('');
    } catch (err) {
      console.error('Failed to load payment submissions:', err);
      // Named, so an empty queue and a broken one are never confusable — the failure this whole
      // app has fixed six times over.
      setError(err.response?.data?.message || 'The online payment queue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  // usePolling only sets the interval — it does not fire on mount. Without this the queue would
  // sit on its loading skeleton for a full cycle before showing anything, which is the shape
  // useBillingQueue uses too.
  useEffect(() => { load(); }, [load]);

  // 20s: a patient who has just paid is watching for their pass, and the cashier is the only
  // thing between them and it. Faster than the 30s default for that reason.
  usePolling(load, 20000, { enabled });

  const verify = async (submission) => {
    if (acting) return;
    setActing(submission.id);
    try {
      const res = await api.post(`/payment-submissions/${submission.id}/verify`);
      const receipt = res.data.data?.payment?.receipt_number;
      await load();
      // Names the patient and the receipt: a bare "Verified" on a queue of six confirms nothing,
      // and the receipt number is what the cashier writes down.
      toastSuccess(`${submission.first_name} ${submission.last_name} — paid. Receipt ${receipt}.`);
    } catch (err) {
      toastError(err.response?.data?.message || 'The payment could not be verified.');
    } finally {
      setActing(null);
    }
  };

  const askReject = (submission) => { setRejectReason(''); setRejecting(submission); };
  const dismissReject = () => { if (!acting) setRejecting(null); };

  const confirmReject = async () => {
    if (!rejecting || acting) return;
    if (!rejectReason.trim()) {
      toastError('Say why — the patient is shown this, and will ask.');
      return;
    }
    setActing(rejecting.id);
    try {
      await api.post(`/payment-submissions/${rejecting.id}/reject`, { reviewNote: rejectReason.trim() });
      const name = `${rejecting.first_name} ${rejecting.last_name}`;
      setRejecting(null);
      await load();
      toastSuccess(`${name}'s payment rejected, with your reason sent to them.`);
    } catch (err) {
      toastError(err.response?.data?.message || 'The payment could not be rejected.');
    } finally {
      setActing(null);
    }
  };

  return {
    submissions, loading, error, reload: load,
    acting, verify,
    rejecting, rejectReason, setRejectReason, askReject, dismissReject, confirmReject,
  };
}
