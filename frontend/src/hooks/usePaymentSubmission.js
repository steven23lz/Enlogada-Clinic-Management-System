import { useState, useEffect, useCallback } from 'react';
import api from '../config/api';
import { toastSuccess } from '../lib/toast';

/**
 * A patient settling a booking by paying into the clinic's own account. [1.48.0]
 *
 * They pay from their own GCash or banking app, then upload the confirmation screenshot with its
 * reference number. A cashier looks at it and approves, and only then is the booking pass issued.
 *
 * ── The state that matters ──────────────────────────────────────────────────────────────────
 *
 * A booking is in exactly one of four situations, and the patient must be able to tell which:
 *
 *   nothing submitted   -> show the accounts and the upload form
 *   awaiting review     -> say so, and do NOT offer a second upload
 *   rejected            -> say why, and offer the form again
 *   verified            -> the pass appears; nothing to do
 *
 * The middle two are the ones a naive implementation loses. A patient who has uploaded and hears
 * nothing assumes it failed and pays twice; a patient whose proof was rejected without a reason
 * rings the clinic, and whoever answers cannot help them.
 */
export function usePaymentSubmission(visitId, { onSettled } = {}) {
  const [methods, setMethods] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [proof, setProof] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    if (!visitId) return;
    setLoading(true);
    // Allowed to fail independently: a patient who cannot see the account list can still be shown
    // what they have already submitted, and vice versa.
    const [m, s] = await Promise.allSettled([
      api.get('/payment-methods'),
      api.get(`/payment-submissions/visit/${visitId}`),
    ]);
    if (m.status === 'fulfilled') setMethods(m.value.data.data.methods || []);
    if (s.status === 'fulfilled') setSubmissions(s.value.data.data.submissions || []);
    setLoading(false);
  }, [visitId]);

  useEffect(() => { reload(); }, [reload]);

  // Newest first from the API, so the head is the current state of play.
  const latest = submissions[0] || null;
  const pending = latest?.status === 'Pending' ? latest : null;
  const rejected = latest?.status === 'Rejected' ? latest : null;
  const verified = submissions.some((s) => s.status === 'Verified');

  const submit = async (e) => {
    e?.preventDefault();
    if (submitting) return;
    setError('');

    if (!reference.trim()) {
      setError('Enter the reference number from your payment confirmation.');
      return;
    }
    if (!proof) {
      setError('Attach a screenshot or photo of the transaction.');
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('patientVisitId', String(visitId));
      if (methodId) fd.append('paymentMethodId', String(methodId));
      fd.append('referenceNumber', reference.trim());
      fd.append('amountClaimed', String(amount || 0));
      fd.append('proof', proof);

      await api.post('/payment-submissions', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setReference('');
      setAmount('');
      setProof(null);
      await reload();
      toastSuccess('Payment sent for verification. Your pass appears once the cashier confirms it.');
      onSettled?.();
    } catch (err) {
      setError(err.response?.data?.message || 'The payment could not be submitted. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return {
    methods, submissions, loading, reload,
    methodId, setMethodId, reference, setReference, amount, setAmount, proof, setProof,
    error, submitting, submit,
    latest, pending, rejected, verified,
  };
}
