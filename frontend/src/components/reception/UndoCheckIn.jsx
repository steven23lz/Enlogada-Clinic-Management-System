import React, { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { toastSuccess } from '../../lib/toast';
import api from '../../config/api';

/**
 * Taking back a check-in made by mistake. [1.156.0] The wrong person's booking, or one for another day.
 * The server refuses once a department has started on it, so this is offered only on a row still in
 * the state a check-in left it in, and asks why: it is in the Activity Log.
 */
export default function UndoCheckIn({ visit, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/appointments/${visit.appointment_id}/undo-check-in`, { reason: reason.trim() });
      setOpen(false);
      setReason('');
      toastSuccess(res.data.message);
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.message || 'The check-in could not be undone.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="xs" data-testid="undo-check-in" onClick={() => { setError(''); setOpen(true); }}>
        <Undo2 className="h-3 w-3" />
        {/* The name says what it undoes; the row's Actions column has no room for it at 1280 wide. */}
        <span aria-hidden="true">Undo</span>
        <span className="sr-only">Undo check-in</span>
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Undo this check-in?"
        description={`${visit.first_name} ${visit.last_name} leaves today's queue and gives up ticket ${visit.queue_number}. If the booking was moved to today by the check-in, it goes back to its own date.`}
        confirmLabel="Undo check-in"
        confirmDisabled={!reason.trim()}
        onConfirm={confirm}
        loading={busy}
        error={error}
      >
        <label htmlFor={`undo-check-in-${visit.id}`} className="field-label">Why</label>
        <Input id={`undo-check-in-${visit.id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Checked in the wrong patient" />
      </ConfirmDialog>
    </>
  );
}
