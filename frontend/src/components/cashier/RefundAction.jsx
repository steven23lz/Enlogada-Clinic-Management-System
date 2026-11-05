import React, { useEffect, useState } from 'react';
import { AlertCircle, Undo2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { LoadingState } from '../ui/loading-state';
import { useAuth } from '../../contexts/AuthContext';
import { COUNTER_PAYMENT_METHODS } from '../../lib/paymentMethods';
import { formatCurrency } from '../../lib/currency';
import { toastSuccess } from '../../lib/toast';
import api from '../../config/api';

const MISTAKE = 'recorded_by_mistake';
const CANNOT = 'clinic_cannot_perform';

/**
 * Giving money back, from a row of the receipt log. [1.155.0]
 *
 * In plain sight and for the SuperAdmin alone (the server decides that, and refuses a receipt they took
 * themselves): a patient changing their mind is not on the list. What it will do is stated before it is
 * done, and the button names the amount.
 */
export default function RefundAction({ transaction, onDone }) {
  const { hasRole } = useAuth();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [kind, setKind] = useState('');
  const [testIds, setTestIds] = useState([]);
  const [reason, setReason] = useState('');
  const [returnedVia, setReturnedVia] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    setOptions(null);
    setLoadError('');
    setKind('');
    setTestIds([]);
    setReason('');
    setReference('');
    setError('');
    setReturnedVia(transaction.payment_method);
    api.get(`/payments/${transaction.id}/refund`)
      .then((res) => { if (current) setOptions(res.data.data); })
      .catch((err) => { if (current) setLoadError(err.response?.data?.message || 'Could not read this receipt.'); });
    return () => { current = false; };
  }, [open, transaction.id, transaction.payment_method]);

  if (!hasRole('SuperAdmin') || transaction.payment_status !== 'Paid' || !transaction.receipt_number) return null;

  const tests = options?.tests || [];
  const open_ = tests.filter((t) => !t.whyNot);
  const amount = kind === MISTAKE
    ? open_.reduce((sum, t) => sum + t.amount, 0)
    : tests.filter((t) => testIds.includes(t.id)).reduce((sum, t) => sum + t.amount, 0);
  const needsReference = returnedVia && returnedVia !== 'Cash';
  const ready = kind && amount > 0 && reason.trim() && returnedVia && (!needsReference || reference.trim());

  const toggle = (id) => setTestIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/payments/${transaction.id}/refund`, {
        kind,
        testIds: kind === CANNOT ? testIds : undefined,
        reason: reason.trim(),
        returnedVia,
        returnedReference: reference.trim() || undefined,
      });
      setOpen(false);
      toastSuccess(`${formatCurrency(res.data.data.amount)} refunded from receipt ${res.data.data.receiptNumber}.`);
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.message || 'The refund could not be recorded. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="xs" data-testid="refund-open" onClick={() => setOpen(true)}>
        <Undo2 className="h-3 w-3" />
        Refund
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="refund-dialog">
          <DialogHeader>
            <DialogTitle>Refund receipt {transaction.receipt_number}</DialogTitle>
            <DialogDescription>
              {options ? `${options.patientName} paid ${formatCurrency(options.amount)} by ${options.paymentMethod}.` : 'Reading the receipt.'}
              {' '}Only for these two cases: a patient changing their mind is not refunded.
            </DialogDescription>
          </DialogHeader>

          {loadError ? (
            <div role="alert" className="alert alert-error"><AlertCircle /><span>{loadError}</span></div>
          ) : !options ? (
            <LoadingState label="Reading the receipt…" />
          ) : options.blocked ? (
            <div role="alert" data-testid="refund-blocked" className="alert alert-warning"><AlertCircle /><span>{options.blocked}</span></div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={busy}>
                <legend className="field-label mb-1.5">Why</legend>
                {options.kinds.map((k) => (
                  <label key={k.value} className="flex cursor-pointer items-start gap-2 text-note text-ink">
                    <input type="radio" name="refund-kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="mt-0.5 accent-brand-500" />
                    <span>{k.label}</span>
                  </label>
                ))}
              </fieldset>

              {kind && (
                <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0" disabled={busy}>
                  <legend className="field-label mb-1.5">{kind === CANNOT ? 'Which tests' : 'The whole receipt goes back'}</legend>
                  {tests.map((t) => (
                    <label
                      key={t.id}
                      data-testid={`refund-test-${t.id}`}
                      className="flex items-start justify-between gap-3 rounded-lg border border-line p-2 text-note"
                    >
                      <span className="flex min-w-0 items-start gap-2">
                        {kind === CANNOT && (
                          <input type="checkbox" disabled={Boolean(t.whyNot)} checked={testIds.includes(t.id)} onChange={() => toggle(t.id)} className="mt-0.5 accent-brand-500" />
                        )}
                        <span className="min-w-0">
                          <span className="block font-semibold text-ink">{t.name}</span>
                          {t.whyNot && <span className="block text-fine text-ink-soft">{t.whyNot}</span>}
                        </span>
                      </span>
                      <span className="flex-shrink-0 tabular-nums text-ink-soft">{formatCurrency(t.amount)}</span>
                    </label>
                  ))}
                  <p className="m-0 mt-1 text-fine leading-relaxed text-ink-soft">
                    {kind === CANNOT
                      ? 'These tests are cancelled and leave the worklist. The rest of the visit carries on. If none are left, the visit ends and a booking\'s time goes back on offer.'
                      : 'The receipt reads Refunded, and the visit owes again, so the right payment can be taken. Its tests wait until then. This is refused if any test on it is done.'}
                  </p>
                </fieldset>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="refund-via" className="field-label">How the money goes back</label>
                  <Select value={returnedVia} onValueChange={setReturnedVia} disabled={busy}>
                    <SelectTrigger id="refund-via"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COUNTER_PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {needsReference && (
                  <div className="space-y-1.5">
                    <label htmlFor="refund-reference" className="field-label">{returnedVia} reference</label>
                    <Input id="refund-reference" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} disabled={busy} />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="refund-reason" className="field-label">What happened</label>
                <Input id="refund-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} disabled={busy} placeholder="The patient is told this" />
              </div>

              {error && <div role="alert" className="alert alert-error"><AlertCircle /><span>{error}</span></div>}

              <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Keep the receipt</Button>
                <Button type="submit" loading={busy} disabled={!ready} data-testid="refund-confirm">
                  Refund {formatCurrency(amount)}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
