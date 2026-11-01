import React, { useEffect, useState } from 'react';
import { AlertCircle, MailCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { useAuth } from '../../contexts/AuthContext';
import { toastSuccess } from '../../lib/toast';

/**
 * A patient changes their sign-in email. [1.147.0]
 *
 * Two steps, the way sign-up proves an address: the new address and the current password (an
 * unlocked phone is not enough), then the 6-digit code sent to the NEW address. Nothing changes
 * until the code is entered, and the old address is told afterwards. A dialog rather than fields
 * in the details panel, which is a form of its own.
 */
export default function ChangeEmailDialog({ open, onOpenChange }) {
  const { user, startEmailChange, confirmEmailChange, resendCode } = useAuth();
  const [step, setStep] = useState('details');
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  // Each opening starts again: a half-finished change is not carried over.
  useEffect(() => {
    if (open) {
      setStep('details'); setNewEmail(''); setPassword(''); setCode(''); setTicket(''); setSentTo('');
      setError(''); setNote('');
    }
  }, [open]);

  const sendCode = async (e) => {
    e.preventDefault();
    setError('');
    if (!newEmail.trim() || !password) {
      setError('Give the new email and your current password.');
      return;
    }
    setBusy(true);
    try {
      const data = await startEmailChange(newEmail.trim(), password);
      setTicket(data.ticket);
      setSentTo(data.email);
      setPassword('');
      setStep('code');
    } catch (err) {
      setError(typeof err === 'string' ? err : 'The code could not be sent. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    setBusy(true);
    try {
      const changed = await confirmEmailChange(ticket, code.trim());
      toastSuccess('Sign-in email changed', `You now sign in with ${changed.email}.`);
      onOpenChange(false);
    } catch (err) {
      setError(typeof err === 'string' ? err : 'That code did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError('');
    setNote('');
    try {
      await resendCode(ticket);
      setNote(`A new code is on its way to ${sentTo}.`);
    } catch (err) {
      setError(typeof err === 'string' ? err : 'A new code could not be sent. Please try again.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-md" data-testid="change-email">
        <DialogHeader>
          <DialogTitle>Change your sign-in email</DialogTitle>
          <DialogDescription>
            {step === 'details'
              ? `You sign in with ${user?.email} now. A code goes to the new address to confirm it is yours.`
              : `We sent a 6-digit code to ${sentTo}. Enter it to finish. Your sign-in email stays the same until you do.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="alert alert-error">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === 'details' ? (
          <form onSubmit={sendCode} noValidate className="flex flex-col gap-4">
            <div>
              <label htmlFor="change-email-new" className="field-label">New email</label>
              <Input
                id="change-email-new"
                type="email"
                autoComplete="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                disabled={busy}
                required
              />
            </div>
            <div>
              <label htmlFor="change-email-password" className="field-label">Your current password</label>
              <Input
                id="change-email-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
              />
              <p className="m-0 mt-1 text-fine text-slate-500">
                Signed up with Google? Set a password first with &quot;Forgot password&quot; on the sign-in page.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" loading={busy}>Send code</Button>
            </div>
          </form>
        ) : (
          <form onSubmit={confirm} noValidate className="flex flex-col gap-4">
            <div>
              <label htmlFor="change-email-code" className="field-label">6-digit code</label>
              <Input
                id="change-email-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                disabled={busy}
                required
              />
              {note && (
                <p className="m-0 mt-1 flex items-center gap-1.5 text-fine text-brand-700">
                  <MailCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {note}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={resend} disabled={busy}>Send a new code</Button>
              <span className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setStep('details')} disabled={busy}>Back</Button>
                <Button type="submit" loading={busy}>Confirm</Button>
              </span>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
