import { useState } from 'react';
import api from '../config/api';
import { toastError } from '../lib/toast';

/**
 * Attaching tests to a visit that arrived without them.
 *
 * The double-submit guard is the reason this is worth its own name. Every other mutation on the
 * reception screen was guarded and this one was not — and it is the one that costs the patient
 * money: `visit_tests` rows carry `price_at_time`, so a double-click on a slow connection
 * attaches the same X-ray twice and bills for both. Keeping the guard beside the submit it
 * guards makes that hard to lose again.
 *
 * @param {() => void} onAssigned  fired after tests are successfully attached
 */
export function useTestAssignment({ onAssigned } = {}) {
  const [visitId, setVisitId] = useState(null);
  const [selectedTestIds, setSelectedTestIds] = useState([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /** Open for a visit, always with an empty basket — a previous visit's picks must not carry. */
  const openFor = (id) => {
    setVisitId(id);
    setSelectedTestIds([]);
    setOpen(true);
  };

  const close = () => {
    if (submitting) return;
    setOpen(false);
  };

  const toggleTest = (testId) => {
    setSelectedTestIds((current) =>
      current.includes(testId) ? current.filter((id) => id !== testId) : [...current, testId]
    );
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!visitId || selectedTestIds.length === 0) return;
    if (submitting) return; // the guard that keeps a slow connection from billing twice
    setSubmitting(true);

    try {
      await api.post('/tests/visit-tests', {
        patientVisitId: visitId,
        testIds: selectedTestIds.map((id) => parseInt(id, 10)),
      });
      setOpen(false);
    } catch (err) {
      toastError(err.response?.data?.message || 'Failed to assign tests to visit');
      return;
    } finally {
      setSubmitting(false);
    }

    onAssigned?.();
  };

  return { visitId, selectedTestIds, open, submitting, openFor, close, toggleTest, submit };
}

export default useTestAssignment;
