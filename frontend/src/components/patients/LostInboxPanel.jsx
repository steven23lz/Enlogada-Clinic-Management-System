import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { toastSuccess } from '../../lib/toast';
import api from '../../config/api';

/**
 * A patient who can no longer open their sign-in email. [1.156.0]
 *
 * Their reset codes go to that inbox, so nothing online can help them. In person only: whoever does this
 * has checked an ID against the record. A code goes to the NEW address and the patient reads it out, which
 * proves the address is theirs. Their sessions end, the old address is told, and it is in the Activity Log.
 */
export default function LostInboxPanel({ patientId, onChanged }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [ticket, setTicket] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/patients/${patientId}/account-email`, { newEmail: email.trim() });
      setTicket(res.data.data.ticket);
    } catch (err) {
      setError(err.response?.data?.message || 'The code could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/patients/${patientId}/account-email/confirm`, { ticket, code: code.trim() });
      toastSuccess(`The sign-in email is now ${email.trim()}. If they have forgotten their password too, "Forgot password" now reaches them there.`);
      setOpen(false);
      setTicket('');
      setCode('');
      setEmail('');
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.message || 'That code could not be checked.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" data-testid="lost-inbox-open" onClick={() => setOpen(true)}>
        Patient lost access to this email
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-slate-50 p-3" data-testid="lost-inbox">
      <p className="m-0 text-note text-slate-700">
        <strong>In person only.</strong> Check their ID against this record first. Never do this over the phone.
      </p>
      {error && <div role="alert" className="alert alert-error"><AlertCircle /><span>{error}</span></div>}
      {!ticket ? (
        <>
          <label htmlFor="lost-inbox-email" className="field-label">Their new email address</label>
          <Input id="lost-inbox-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" loading={busy} disabled={!email.trim()} onClick={send}>Send a code to it</Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </>
      ) : (
        <>
          <label htmlFor="lost-inbox-code" className="field-label">The code sent to {email.trim()}</label>
          <Input id="lost-inbox-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" loading={busy} disabled={code.trim().length !== 6} onClick={confirm}>Change the sign-in email</Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </>
      )}
    </div>
  );
}
