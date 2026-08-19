import { useState } from 'react';
import api from '../config/api';

/**
 * Reversing a payment that should not have been taken.
 *
 * Third of the four groups CashierDashboard was carrying. Small, but worth its own name for the
 * same reason as the others: four pieces of state and a handler that no other part of the screen
 * has any business reading, sitting in the middle of a file that also renders a queue and a till.
 *
 * `onRefunded` is how the list behind it refreshes. The hook does not know or care which list
 * that is — the transaction log today, and whatever else needs re-reading later.
 *
 * The reason requirement is enforced on the server too (paymentService refuses a reversal without
 * one). It is repeated here so the cashier is told before the round trip rather than after, not
 * because the client is trusted with the rule.
 */
export function useRefund({ onRefunded } = {}) {
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  /** Open the confirmation for one payment. */
  const request = (payment) => {
    setError('');
    setReason('');
    setTarget(payment);
  };

  /** Close without doing anything — refused while a reversal is in flight. */
  const cancel = () => {
    if (submitting) return;
    setTarget(null);
  };

  const confirm = async () => {
    if (!target) return;
    setError('');

    if (reason.trim().length < 3) {
      setError('A reason is required (at least 3 characters) — this becomes part of the audit trail.');
      return;
    }

    setSubmitting(true);
    try {
      await api.patch(`/payments/${target.id}/status`, { status: 'Refunded', reason: reason.trim() });
      setTarget(null);
      onRefunded?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to refund this payment.');
    } finally {
      setSubmitting(false);
    }
  };

  return { target, reason, setReason, submitting, error, request, cancel, confirm };
}
