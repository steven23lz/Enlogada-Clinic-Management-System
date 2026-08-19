import { useState } from 'react';
import api from '../config/api';

/**
 * The front desk's check-in: verifying a booking reference (typed or scanned), and admitting
 * either that appointment or a patient found by lookup.
 *
 * Verification and check-in are one journey, not two — you verify in order to check in, and a
 * successful check-in clears the verification so the form is ready for the next patient. Held
 * apart, that clearing is the sort of thing a screen forgets to do.
 *
 * Both paths funnel through one `target` and one confirmation [UI/UX Phase 3]. They used to be
 * independent: the reference flow asked for confirmation, while checking in a patient found via
 * the registration lookup fired immediately with none. Check-in is operationally significant
 * either way — it advances an appointment and visit status, or creates a brand-new visit — so
 * both ask.
 *
 * `onCheckedIn` is how a success leaves, carrying enough for the caller to decide what it means:
 * the queue always wants refreshing, and the walk-in path additionally has a ticket number the
 * lookup panel needs to announce. Same shape as useCheckout's `onPaid`.
 *
 * @param {(result: {type: 'appointment'|'walkin', patient?: object, visit?: object}) => void} onCheckedIn
 */
export function useAppointmentCheckIn({ onCheckedIn } = {}) {
  const [reference, setReference] = useState('');
  const [result, setResult] = useState(null);
  const [verifyError, setVerifyError] = useState('');
  const [scanMode, setScanMode] = useState(false);

  /**
   * Where to send the patient once they are in.
   *
   * A successful check-in clears `result` so the form resets, which also removes the only thing
   * on screen naming the patient. This short-lived message is built from the visit's attached
   * test categories and survives that reset, so the receptionist can still say where to go.
   */
  const [guidance, setGuidance] = useState(null);

  const [target, setTarget] = useState(null); // { type: 'appointment' | 'walkin', data }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const verify = async (e, refOverride) => {
    e?.preventDefault?.();
    setVerifyError('');
    setResult(null);
    setGuidance(null);

    const ref = refOverride ?? reference;
    if (!ref) return;

    try {
      const response = await api.get(`/appointments/verify/${ref}`);
      setResult(response.data.data.appointment);
    } catch (err) {
      setVerifyError(err.response?.data?.message || 'Appointment reference lookup failed.');
    }
  };

  /** A scanned QR code is just a reference that arrived faster. */
  const scanned = (decodedText) => {
    setReference(decodedText);
    verify(null, decodedText);
  };

  const toggleScanMode = () => setScanMode((on) => !on);

  /** Ask before admitting. `type` is 'appointment' or 'walkin'. */
  const request = (type, data) => {
    setError('');
    setNotice('');
    setTarget({ type, data });
  };

  const cancel = () => {
    if (submitting) return;
    setTarget(null);
  };

  const confirm = async () => {
    if (!target) return;
    setSubmitting(true);
    setError('');

    let outcome;
    try {
      if (target.type === 'appointment') {
        const { id: appointmentId, is_paid: isPaid, first_name, last_name, categories } = target.data;
        // Confirming the appointment is the front desk's HALF of the release rule. The backend
        // releases the ticket to the modalities only once payment has also landed — this screen
        // no longer PATCHes the visit status itself, which used to push unpaid visits straight
        // onto the diagnostic worklists.
        await api.patch(`/appointments/${appointmentId}/status`, { status: 'Confirmed' });
        setNotice(
          isPaid
            ? 'Checked in and released — the ticket is now on the department worklist.'
            : 'Checked in. Payment is still outstanding, so please send the patient to the cashier — the ticket reaches the department once payment is confirmed.'
        );
        setReference('');
        setResult(null);
        setGuidance({ patientName: `${first_name} ${last_name}`, categories: categories || [] });
        outcome = { type: 'appointment' };
      } else {
        const patient = target.data;
        // No notes. [1.29.0] This used to read the "Visit Notes / Referral Reason" input from
        // the REGISTRATION form in the panel below — a form the receptionist is not using when
        // they check in a patient they just found by search. A half-typed registration note
        // ended up attached to a returning patient's visit, silently, against a patient the
        // note was never about. That shared ambient state is also what made this screen resist
        // being split up: the coupling was the design pointing at the bug.
        const vRes = await api.post('/visits', { patientId: patient.id, visitType: 'Walk in' });
        outcome = { type: 'walkin', patient, visit: vRes.data.data.visit };
      }
      setTarget(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to check in patient');
      return;
    } finally {
      setSubmitting(false);
    }

    // The patient is admitted; anything after this is follow-up and must not be able to report
    // the check-in as failed.
    onCheckedIn?.(outcome);
  };

  /**
   * Forget the verified booking and empty the field — what marking an appointment 'No Show'
   * wants, since leaving it on screen invites checking in someone who is not coming.
   */
  const clearResult = () => {
    setResult(null);
    setReference('');
  };

  /** A scan failed. The camera reports through the same channel a bad reference does. */
  const reportError = (message) => setVerifyError(message);

  /**
   * Change the booking on screen without re-verifying it — for a reschedule, which alters the
   * time of the very appointment being looked at. Clearing the panel instead would make the
   * receptionist re-scan just to confirm the move landed.
   */
  const applyToResult = (patch) => setResult((prev) => (prev ? { ...prev, ...patch } : prev));

  return {
    reference, setReference,
    result, verifyError, scanMode, guidance,
    target, submitting, error, notice,
    verify, scanned, toggleScanMode, request, cancel, confirm,
    clearResult, reportError, applyToResult,
  };
}

export default useAppointmentCheckIn;
