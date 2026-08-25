import React, { useState } from 'react';
import { Clock, AlertCircle, Upload, Copy, Check, QrCode } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { formatCurrency } from '../../lib/currency';
import { usePaymentSubmission } from '../../hooks/usePaymentSubmission';
import api from '../../config/api';

/**
 * Paying for a booking from home. [1.48.0]
 *
 * The clinic publishes its own GCash/bank accounts; the patient sends the money themselves and
 * uploads the confirmation. A cashier checks it and the booking pass appears.
 *
 * ── Copy buttons, not just text ─────────────────────────────────────────────────────────────
 *
 * The patient is going to retype an eleven-digit number into a banking app. Every digit they type
 * by hand is a chance to send the clinic's money to a stranger, and neither party would find out
 * until it did not arrive. A copy button removes the retyping entirely.
 */

/** The QR image, fetched with the session's auth header rather than as a bare <img src>. */
function MethodQr({ methodId, label }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  React.useEffect(() => {
    let revoked = false;
    let objectUrl = '';
    // The route requires a token, so a plain <img src> would 401. Fetched as a blob through the
    // configured axios instance, which carries the header — the same reason HMO card previews do.
    api.get(`/payment-methods/${methodId}/qr`, { responseType: 'blob' })
      .then((res) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      })
      .catch(() => setFailed(true));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [methodId]);

  if (failed) return null;
  if (!src) return <div className="h-36 w-36 animate-pulse rounded-lg bg-slate-100" aria-hidden="true" />;
  return <img src={src} alt={`${label} QR code`} className="h-36 w-36 rounded-lg border border-line object-contain" />;
}

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is unavailable over plain http and in some embedded browsers. The number is
      // still on screen and selectable, so this fails quietly rather than claiming success.
    }
  };
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-inset ring-line">
      <span className="min-w-0">
        <span className="block text-micro font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</span>
        <span className="block truncate font-mono text-note font-bold tabular-nums text-slate-900">{value}</span>
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-brand-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export default function PayBookingPanel({ visitId, amountDue, onSettled }) {
  const pay = usePaymentSubmission(visitId, { onSettled });
  const selected = pay.methods.find((m) => String(m.id) === String(pay.methodId)) || pay.methods[0];

  if (pay.loading) {
    return <div className="h-24 animate-pulse rounded-xl bg-slate-100" aria-hidden="true" />;
  }

  // Already sent, awaiting a human. No second upload offered — a duplicate is refused by the
  // server anyway, and offering the form invites a patient to pay twice.
  if (pay.pending) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
        <p className="m-0 flex items-center gap-1.5 text-note font-semibold text-amber-900">
          <Clock className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          Payment sent for checking
        </p>
        <p className="m-0 mt-1 text-fine leading-relaxed text-amber-800">
          Reference <strong className="font-mono">{pay.pending.reference_number}</strong>. The clinic
          verifies it during opening hours — your booking pass appears here as soon as they do.
        </p>
      </div>
    );
  }

  if (pay.methods.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-slate-50 p-3.5">
        <p className="m-0 text-fine leading-relaxed text-slate-600">
          Online payment is not set up yet. Please pay at the counter when you arrive.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-azure-200 bg-azure-50/40 p-3.5">
      <div>
        <p className="m-0 text-note font-bold text-slate-900">Pay to confirm this booking</p>
        <p className="m-0 mt-0.5 text-fine leading-relaxed text-slate-600">
          Send {amountDue ? <strong>{formatCurrency(amountDue)}</strong> : 'the amount due'} to the
          account below, then upload the confirmation. Your pass is issued once the clinic checks it.
        </p>
      </div>

      {/* A rejection has to say why, and offer another go. */}
      {pay.rejected && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-2.5">
          <p className="m-0 flex items-center gap-1.5 text-fine font-semibold text-rose-800">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            Your last payment could not be confirmed
          </p>
          <p className="m-0 mt-0.5 text-fine leading-relaxed text-rose-700">
            {pay.rejected.review_note} — you can submit again below.
          </p>
        </div>
      )}

      {pay.methods.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {pay.methods.map((m) => {
            const on = String(m.id) === String(selected?.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => pay.setMethodId(String(m.id))}
                className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-fine font-semibold transition-colors ${
                  on ? 'border-azure-400 bg-white text-azure-800' : 'border-line bg-white/60 text-slate-600 hover:bg-white'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="flex flex-col gap-3 sm:flex-row">
          {selected.has_qr && (
            <div className="flex flex-shrink-0 flex-col items-center gap-1">
              <MethodQr methodId={selected.id} label={selected.label} />
              <span className="flex items-center gap-1 text-micro font-semibold text-slate-500">
                <QrCode className="h-3 w-3" aria-hidden="true" />
                Scan to pay
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1.5">
            <CopyField
              label={selected.kind === 'Bank' ? 'Account number' : 'GCash number'}
              value={selected.account_number}
            />
            {selected.account_name && (
              <p className="m-0 text-fine text-slate-600">
                Account name: <strong>{selected.account_name}</strong>
                {selected.bank_name ? ` · ${selected.bank_name}` : ''}
              </p>
            )}
            {selected.instructions && (
              <p className="m-0 text-fine leading-relaxed text-slate-600">{selected.instructions}</p>
            )}
          </div>
        </div>
      )}

      <form onSubmit={pay.submit} className="space-y-2 border-t border-azure-200 pt-3">
        {pay.error && (
          <div role="alert" className="alert alert-error">
            <AlertCircle />
            <span>{pay.error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor={`ref-${visitId}`} className="field-label">Reference number</label>
            <Input
              id={`ref-${visitId}`}
              value={pay.reference}
              onChange={(e) => pay.setReference(e.target.value)}
              placeholder="From your payment confirmation"
              disabled={pay.submitting}
            />
          </div>
          <div>
            <label htmlFor={`amt-${visitId}`} className="field-label">Amount sent</label>
            <Input
              id={`amt-${visitId}`}
              type="number"
              min="0"
              step="0.01"
              value={pay.amount}
              onChange={(e) => pay.setAmount(e.target.value)}
              placeholder={amountDue ? String(amountDue) : '0.00'}
              disabled={pay.submitting}
            />
          </div>
        </div>

        <div>
          <label htmlFor={`proof-${visitId}`} className="field-label">Screenshot of the transaction</label>
          <input
            id={`proof-${visitId}`}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => pay.setProof(e.target.files?.[0] || null)}
            disabled={pay.submitting}
            className="block w-full cursor-pointer rounded-lg border border-slate-200 bg-white p-2 text-fine text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-fine file:font-semibold file:text-slate-700"
          />
        </div>

        <Button type="submit" loading={pay.submitting} className="w-full">
          <Upload className="h-4 w-4" />
          Send for verification
        </Button>
      </form>
    </div>
  );
}
