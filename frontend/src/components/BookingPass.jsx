import React, { useEffect, useState } from 'react';
import { QrCode, AlertCircle, ExternalLink, Clock } from 'lucide-react';

/**
 * The scannable booking pass for a paid online appointment.
 *
 * The clinic already had a QR *scanner* (QrScanner.jsx, used by the receptionist's check-in
 * screen) and appointments already carried an `appointment_reference` — but nothing ever
 * rendered a code for the patient to present, so the camera had nothing to read and reception
 * had to type references by hand. This closes that loop.
 *
 * The encoded payload is the plain appointment reference, exactly what
 * `GET /appointments/verify/:reference` expects, so a scan and a manual entry are the same
 * lookup. Nothing sensitive is encoded — the reference is useless without a receptionist
 * account to verify it against.
 *
 * `qrcode` is imported lazily so it never lands in the initial bundle: only clients who have a
 * paid booking ever need the encoder. Mirrors how QrScanner.jsx defers html5-qrcode.
 */
/**
 * "About 20 minutes — 3 patients ahead of you." [1.62.0]
 *
 * ── Every word here is hedged on purpose ────────────────────────────────────────────────────
 *
 * "About", and a number rounded to five minutes. The estimate is a queue length times a measured
 * service rate, and it cannot account for the patient in front who turns out to need three tests
 * explained. A clinic that says "18 minutes" has made a promise; one that says "about 20 minutes"
 * has given an estimate, and only the second is true.
 *
 * The head count is shown BESIDE the time rather than instead of it, because it is the part the
 * patient can verify. A number that ticks down from 3 to 2 to 1 is visibly working; a time on its
 * own, from a system that has been wrong before, is not believed.
 *
 * Renders nothing at all when there is no estimate — a booking for next week, or a patient already
 * past the desk. A "0 minute wait" on a booking three days out would be absurd, and an empty
 * placeholder saying "wait unknown" is worse than the silence this had before.
 */
const QueueWait = ({ minutes, ahead, capped }) => {
  if (minutes === null || minutes === undefined) return null;

  const people = Number(ahead) || 0;
  const crowd = people === 0
    ? "you're next in line"
    : `${people} patient${people === 1 ? '' : 's'} ahead of you`;

  return (
    <span className="mt-1.5 flex flex-col items-center gap-0.5 rounded-lg bg-brand-50 px-3 py-1.5 ring-1 ring-inset ring-brand-100">
      <span className="flex items-center gap-1.5 text-note font-bold text-brand-800">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {capped ? 'Over 90 minutes' : `About ${minutes} minutes`}
      </span>
      <span className="text-micro font-semibold text-brand-700">{crowd}</span>
    </span>
  );
};

const BookingPass = ({
  reference,
  queueNumber,
  isPaid,
  canPayOnline = false,
  receiptNumber = null,
  // [1.62.0] Absent on any booking not currently in today's queue, and the pass simply omits the
  // estimate in that case rather than showing a zero.
  estimatedWaitMinutes = null,
  patientsAhead = null,
  estimateIsCapped = false,
}) => {
  const [dataUrl, setDataUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      if (!reference) return;
      try {
        const { default: QRCode } = await import('qrcode');
        const url = await QRCode.toDataURL(reference, {
          width: 220,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#192534', light: '#ffffff' }
        });
        if (!cancelled) setDataUrl(url);
      } catch {
        // The reference is always shown as text below, so a failed encode degrades to manual
        // entry at the desk rather than blocking check-in.
        if (!cancelled) setFailed(true);
      }
    };

    render();
    return () => {
      cancelled = true;
    };
  }, [reference]);

  return (
    <div className="flex flex-col items-center gap-2 p-4 bg-white border border-gray-200 rounded-xl">
      <span className="text-meta font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
        <QrCode className="w-3.5 h-3.5 text-brand-600" aria-hidden="true" />
        Present this at the front desk
      </span>

      {dataUrl ? (
        <img
          src={dataUrl}
          alt={`QR code for appointment reference ${reference}`}
          className="w-40 h-40"
        />
      ) : failed ? (
        <div
          role="alert"
          className="w-40 h-40 flex items-center justify-center text-center text-meta text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2"
        >
          <span className="flex flex-col items-center gap-1">
            <AlertCircle className="w-4 h-4" aria-hidden="true" />
            QR code unavailable — give the reference below to the receptionist.
          </span>
        </div>
      ) : (
        <div className="w-40 h-40 bg-skeleton rounded-lg animate-pulse" aria-hidden="true" />
      )}

      <span className="font-mono text-note font-bold tracking-wide text-slate-900">{reference}</span>
      {queueNumber && (
        <span className="text-micro font-semibold text-slate-500">Queue Ticket {queueNumber}</span>
      )}

      {/* The answer to the question the ticket number does not answer. [1.62.0]
          The clinic has issued queue tickets since [1.0.0], and "you are number 12" tells a
          patient where they are without telling them what they wanted to know. The wait comes
          first and is the larger type because it is the part being asked about; the head count is
          what makes it believable, and is what lets someone watch it go down. */}
      <QueueWait minutes={estimatedWaitMinutes} ahead={patientsAhead} capped={estimateIsCapped} />

      {/* Payment is stated on the pass rather than deciding whether the pass exists at all.
          A patient walking in with an unpaid booking still needs a code to be scanned; what they
          also need is to know they will be paying at the counter first. */}
      {/* Only when there is no online option. [1.37.0] Gated on isPaid alone, this rendered
          "Payment due at the counter" on the same card as the Pay with GCash buttons — the clinic
          telling one patient two different things about one booking. */}
      {isPaid === false && !canPayOnline && (
        <span className="mt-1 rounded-md bg-amber-50 px-2 py-0.5 text-micro font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
          Payment due at the counter
        </span>
      )}
      {isPaid === true && (
        <span className="mt-1 rounded-md bg-emerald-50 px-2 py-0.5 text-micro font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
          Paid
        </span>
      )}

      {/* The receipt rides WITH the pass once the money is in. [1.52.0]
          ── Why it is beside the QR and not inside it ──────────────────────────────────────────
          The QR encodes the appointment reference and nothing else, because ReceptionistDashboard's
          scanner hands whatever it decodes straight to GET /appointments/verify/:ref. Packing a
          second value in would not give the patient more — it would stop check-in working, since
          the decoded string would no longer be a reference the endpoint recognises.
          So the pass carries both: the code the desk scans, and the receipt number the patient is
          actually asked for by an HMO or an employer, openable as a real printable document. */}
      {isPaid === true && receiptNumber && (
        <span className="mt-1.5 flex flex-col items-center gap-0.5">
          <span className="text-micro text-slate-500">
            Receipt <span className="font-mono font-semibold text-slate-700">{receiptNumber}</span>
          </span>
          <button
            type="button"
            onClick={() => window.open(`?receipt=${encodeURIComponent(receiptNumber)}`, '_blank', 'noopener')}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent p-0 text-micro font-semibold text-azure-700 underline underline-offset-2 hover:text-azure-800"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            View / print receipt
          </button>
        </span>
      )}
    </div>
  );
};

export default BookingPass;
