import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';

/**
 * A patient's own bookings: seeing them, cancelling one, moving one, and paying for one.
 *
 * Paying is here rather than with the payment history because it acts on an appointment — the
 * button sits on the booking card and the checkout is opened for that visit. The history is the
 * record afterwards, and a separate concern.
 *
 * The gateway rule is the important one and it is not negotiable: this function's job ends at
 * the redirect. The visit is NOT marked paid here, and not on return either — only the signed
 * provider webhook may do that. The `?payment=` flag the browser comes back with says "the
 * browser came back", not "the money arrived".
 */
export function useMyAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const [rescheduling, setRescheduling] = useState(null);

  const [gateway, setGateway] = useState({ available: false, methods: [] });
  const [payingId, setPayingId] = useState(null);
  const [payError, setPayError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/appointments/my-bookings');
      setAppointments(response.data.data.bookings || []);
    } catch (err) {
      console.error('Failed to fetch appointments:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGateway = useCallback(async () => {
    try {
      const response = await api.get('/payments/gateway/status');
      setGateway(response.data.data.gateway || { available: false, methods: [] });
    } catch {
      // Any failure is "not available". Never offer a payment route we cannot confirm exists.
      setGateway({ available: false, methods: [] });
    }
  }, []);

  useEffect(() => {
    load();
    loadGateway();
  }, [load, loadGateway]);

  const requestCancel = (appointment) => {
    setCancelError('');
    setCancelTarget(appointment);
  };

  const dismissCancel = () => {
    if (cancelling) return;
    setCancelTarget(null);
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    setCancelError('');
    try {
      await api.put(`/appointments/${cancelTarget.id}/cancel`);
      setCancelTarget(null);
    } catch (err) {
      setCancelError(err.response?.data?.message || 'Failed to cancel appointment.');
      return;
    } finally {
      setCancelling(false);
    }
    load();
  };

  const openReschedule = (appointment) => setRescheduling(appointment);
  const closeReschedule = () => setRescheduling(null);

  /** Hands the browser to the provider's hosted page. Nothing here decides whether it was paid. */
  const payOnline = async (appointment, method) => {
    setPayError('');
    setPayingId(appointment.id);
    try {
      const response = await api.post('/payments/gateway/checkout', {
        patientVisitId: appointment.patient_visit_id,
        paymentMethod: method,
      });
      window.location.href = response.data.data.checkout.checkoutUrl;
    } catch (err) {
      setPayError(err.response?.data?.message || `Could not start the ${method} payment. Please try again.`);
      setPayingId(null);
    }
  };

  /** The patient backed out on the provider's page — the booking is untouched and still theirs. */
  const notePaymentCancelled = () =>
    setPayError('Payment was cancelled. Your booking is still reserved — you can pay again below or at the clinic.');

  const clearPayError = () => setPayError('');

  return {
    appointments, loading, page, setPage,
    cancelTarget, cancelling, cancelError, requestCancel, dismissCancel, confirmCancel,
    rescheduling, openReschedule, closeReschedule,
    gateway, payingId, payError, payOnline, notePaymentCancelled, clearPayError,
    reload: load,
  };
}

export default useMyAppointments;
