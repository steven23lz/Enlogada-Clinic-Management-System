import React, { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { toastSuccess, toastWarning } from '../../lib/toast';
import api from '../../config/api';

/**
 * Pulling a released report back from the patient. [1.156.0] For a report released on the wrong patient,
 * or the wrong file. An amendment leaves the old version readable until the new one is released, which is
 * right for a figure being corrected and wrong for someone else's report. It returns to the worklist.
 */
export default function WithdrawReport({ test, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/results/${test.visit_test_id}/withdraw`, { reason: reason.trim() });
      setOpen(false);
      setReason('');
      if (res.data.data.emailedTo) {
        toastWarning(res.data.message, `A copy was already emailed to ${res.data.data.emailedTo}. That cannot be recalled: please call the patient.`);
      } else {
        toastSuccess(res.data.message);
      }
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.message || 'The report could not be withdrawn.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="xs" data-testid="withdraw-report" onClick={() => { setError(''); setOpen(true); }}>
        <Undo2 className="h-3 w-3" />
        <span>Withdraw</span>
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Withdraw this report?"
        description={`${test.first_name} ${test.last_name} stops being able to read ${test.test_name} at once, and it returns to the worklist. To correct a figure, use Edit instead: the patient keeps the report until the new one is released.`}
        confirmLabel="Withdraw report"
        confirmDisabled={!reason.trim()}
        onConfirm={confirm}
        loading={busy}
        error={error}
      >
        <label htmlFor={`withdraw-${test.visit_test_id}`} className="field-label">Why</label>
        <Input id={`withdraw-${test.visit_test_id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Released on the wrong patient" />
      </ConfirmDialog>
    </>
  );
}
