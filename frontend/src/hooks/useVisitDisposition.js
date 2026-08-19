import { useState } from 'react';
import api from '../config/api';

/**
 * The three ways a visit stops proceeding as booked: cancelled, marked a no-show, or moved.
 *
 * Grouped because they answer one question — "this patient is not being seen as planned, now
 * what" — and because they share a consequence: every one of them changes who is waiting, so
 * the queue behind them has to be re-read. That consequence is exactly what was missing before
 * [1.29.0]; marking a no-show did not refetch, so the absent patient stayed on the Active Queue
 * for the rest of the session and staff went chasing — or re-checking-in — someone already
 * marked absent.
 *
 * Exposed as three named sub-objects rather than twelve flat fields. `disposition.cancel.target`
 * and `disposition.noShow.target` are two different targets that must never be confused, and
 * flattening them to `cancelTarget` / `noShowTarget` is the naming convention that invites
 * exactly that confusion at the fourth call site.
 *
 * Both endpoints have always accepted 'Cancelled' and 'No Show' [Feature Gap Plan Phase A] —
 * nothing in the receptionist UI ever sent either, so a no-show appointment or a mis-registered
 * walk-in had no way off the queue at all.
 *
 * @param {(change: {type: 'cancel'|'noShow'}) => void} onChanged  fired after a successful change
 */
export function useVisitDisposition({ onChanged } = {}) {
  const [cancelTarget, setCancelTarget] = useState(null);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const [noShowTarget, setNoShowTarget] = useState(null);
  const [markingNoShow, setMarkingNoShow] = useState(false);
  const [noShowError, setNoShowError] = useState('');

  /** The verified booking currently open in the reschedule dialog, or null. */
  const [reschedulingAppointment, setReschedulingAppointment] = useState(null);

  const cancelFlow = {
    target: cancelTarget,
    submitting: canceling,
    error: cancelError,
    request: (visit) => {
      setCancelError('');
      setCancelTarget(visit);
    },
    dismiss: () => {
      if (canceling) return;
      setCancelTarget(null);
    },
    confirm: async () => {
      if (!cancelTarget) return;
      setCanceling(true);
      setCancelError('');
      try {
        await api.patch(`/visits/${cancelTarget.id}/status`, { status: 'Cancelled' });
        setCancelTarget(null);
      } catch (err) {
        setCancelError(err.response?.data?.message || 'Failed to cancel this visit.');
        return;
      } finally {
        setCanceling(false);
      }
      onChanged?.({ type: 'cancel' });
    },
  };

  const noShowFlow = {
    target: noShowTarget,
    submitting: markingNoShow,
    error: noShowError,
    request: (appointment) => {
      setNoShowError('');
      setNoShowTarget(appointment);
    },
    dismiss: () => {
      if (markingNoShow) return;
      setNoShowTarget(null);
    },
    confirm: async () => {
      if (!noShowTarget) return;
      setMarkingNoShow(true);
      setNoShowError('');
      try {
        await api.patch(`/appointments/${noShowTarget.id}/status`, { status: 'No Show' });
        setNoShowTarget(null);
      } catch (err) {
        setNoShowError(err.response?.data?.message || 'Failed to mark this appointment as a no-show.');
        return;
      } finally {
        setMarkingNoShow(false);
      }
      onChanged?.({ type: 'noShow' });
    },
  };

  const rescheduleFlow = {
    appointment: reschedulingAppointment,
    open: (appointment) => setReschedulingAppointment(appointment),
    close: () => setReschedulingAppointment(null),
  };

  return { cancel: cancelFlow, noShow: noShowFlow, reschedule: rescheduleFlow };
}

export default useVisitDisposition;
