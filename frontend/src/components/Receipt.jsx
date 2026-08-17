import React from 'react';
import { useClinic, hasStatutoryIdentity } from '../lib/clinic';
import { formatCurrency } from '../lib/currency';

/**
 * The document the patient walks out with.
 *
 * ── What was wrong with the previous one ──────────────────────────────────────────────────────
 * It printed. That was about the extent of it. Three problems, in rising order of seriousness:
 *
 *  1. The action buttons sat INSIDE `.print-area`, so "Print Receipt" printed its own button.
 *     The print rule in index.css hides `body *` and reveals only `.print-area` and its
 *     descendants — put the toolbar in there and the toolbar comes out of the printer.
 *
 *  2. It carried no date, no time, no cashier, no visit reference, no clinic address, no contact
 *     details, and — for a cash sale — neither the amount tendered nor the change given. A
 *     receipt with no date is not a receipt; it is a note saying a number.
 *
 *  3. It reconciled its own arithmetic from `paymentSuccess.amount + discount + vat` but never
 *     showed the reader how, so a patient checking whether the senior discount was actually
 *     applied had to do the subtraction themselves.
 *
 * ── Deliberately not claiming to be a BIR Official Receipt ────────────────────────────────────
 * It says "Payment Receipt" and, when the clinic's TIN is not configured, prints a line saying it
 * is not a BIR-registered Official Receipt. Fabricating a TIN or an OR series to make the
 * document look official would produce a false record that a patient might file for
 * reimbursement. Set VITE_CLINIC_TIN and the wording upgrades itself (see lib/clinic.js).
 *
 * ── Why 80mm ──────────────────────────────────────────────────────────────────────────────────
 * Clinic counters print to thermal roll, not A4. The @page rule in index.css sizes the sheet to
 * 80mm so the output is not one narrow column stranded at the top-left of a portrait page.
 */

const Row = ({ label, value, strong = false, tone = 'default', small = false }) => (
  <div className={`flex items-baseline justify-between gap-3 ${small ? 'text-[10px]' : 'text-[11px]'}`}>
    <span className={strong ? 'font-bold text-slate-900' : 'text-slate-500'}>{label}</span>
    <span
      className={`tabular-nums ${
        strong ? 'font-bold text-slate-900' : tone === 'credit' ? 'font-semibold text-slate-700' : 'font-medium text-slate-800'
      }`}
    >
      {value}
    </span>
  </div>
);

const Rule = ({ dashed = false }) => (
  <div className={`my-2 border-t ${dashed ? 'border-dashed border-slate-300' : 'border-slate-300'}`} />
);

/**
 * @param payment  the payments row as returned by the API (the snapshot, not the live catalogue —
 *                 a reprint years later must show what was actually granted at the time)
 * @param bill     the itemised bill this payment settled
 * @param cashier  who took the money; a receipt with no attribution cannot be queried later
 * @param tendered / change  cash only, and only meaningful at the moment of sale
 * @param reprint  stamps the copy, so an original and a duplicate are distinguishable
 */
const Receipt = ({ payment, bill, cashier, tendered, change, reprint = false }) => {
  // Fetched at runtime so the clinic can set its TIN without rebuilding the frontend; falls back
  // to the built-in name and address if the API is unreachable. See lib/clinic.js.
  const CLINIC = useClinic();
  if (!payment) return null;

  const paidAt = payment.paid_at ? new Date(payment.paid_at) : new Date();
  const discount = parseFloat(payment.discount_amount || 0);
  const vat = parseFloat(payment.vat_amount || 0);
  const net = parseFloat(payment.amount || 0);
  // The receipt reconciles from the payment row alone, so it stays correct even if the bill
  // object is unavailable on a reprint: amount + discount + vat === the VAT-inclusive gross.
  const gross = net + discount + vat;
  const isCash = payment.payment_method === 'Cash';

  return (
    <div className="print-area mx-auto w-full max-w-[320px] bg-white p-4 font-sans text-slate-900">
      <header className="text-center">
        <h2 className="m-0 text-[13px] font-extrabold uppercase tracking-wide">{CLINIC.shortName}</h2>
        <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
          Ultrasound &amp; Diagnostic Clinic
        </p>
        <p className="m-0 mt-1 text-[10px] leading-snug text-slate-500">{CLINIC.address}</p>
        <p className="m-0 text-[10px] leading-snug text-slate-500">
          {CLINIC.phone} · {CLINIC.email}
        </p>
        {CLINIC.tin && <p className="m-0 text-[10px] font-semibold text-slate-600">TIN {CLINIC.tin}</p>}
      </header>

      <Rule />

      <p className="m-0 text-center text-[11px] font-bold uppercase tracking-[0.12em]">
        {hasStatutoryIdentity(CLINIC) ? 'Official Receipt' : 'Payment Receipt'}
      </p>
      {reprint && (
        <p className="m-0 mt-0.5 text-center text-[10px] font-bold uppercase tracking-widest text-rose-600">
          Reprint — duplicate copy
        </p>
      )}

      <Rule dashed />

      <div className="space-y-0.5">
        <Row label="Receipt No." value={payment.receipt_number || `OR-${payment.id}`} strong />
        <Row label="Date" value={paidAt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })} />
        <Row label="Time" value={paidAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} />
        {bill?.patientName && <Row label="Patient" value={bill.patientName} />}
        {bill?.queueNumber && <Row label="Queue" value={bill.queueNumber} />}
        {cashier && <Row label="Cashier" value={cashier} />}
      </div>

      <Rule dashed />

      {bill?.items?.length > 0 && (
        <>
          <p className="m-0 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Services</p>
          <div className="space-y-0.5">
            {bill.items.map((item, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-slate-700">{item.name}</span>
                <span className="tabular-nums font-medium">{formatCurrency(item.price)}</span>
              </div>
            ))}
          </div>
          <Rule dashed />
        </>
      )}

      <div className="space-y-0.5">
        <Row label="Gross amount" value={formatCurrency(gross)} />

        {/* The statutory ladder, itemised by name and rate rather than folded into one figure —
            RA 9994 / RA 10754. The receipt is the patient's evidence the mandated deduction was
            given, and the clinic's evidence for claiming it back. VAT comes off FIRST: the sale
            is VAT-exempt, so the 20% applies to the VAT-exempt base, not the shelf price. */}
        {vat > 0 && (
          <>
            <Row label="Less VAT (12%)" value={`- ${formatCurrency(vat)}`} tone="credit" />
            <Row label="VAT-exempt sale" value={formatCurrency(net + discount)} />
          </>
        )}
        {discount > 0 && (
          <>
            <Row
              label={`${payment.discount_type_name || 'Discount'} (20%)`}
              value={`- ${formatCurrency(discount)}`}
              tone="credit"
            />
            {payment.discount_id_number && (
              <Row small label="ID presented" value={payment.discount_id_number} />
            )}
          </>
        )}
        {parseFloat(bill?.hmoCoverage || 0) > 0 && (
          <Row label="HMO coverage" value={`- ${formatCurrency(bill.hmoCoverage)}`} tone="credit" />
        )}
      </div>

      <Rule />

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-extrabold uppercase tracking-wide">Amount paid</span>
        <span className="text-[15px] font-extrabold tabular-nums">{formatCurrency(net)}</span>
      </div>

      <Rule dashed />

      <div className="space-y-0.5">
        <Row label="Payment method" value={payment.payment_method} />
        {payment.reference_number && <Row label="Reference" value={payment.reference_number} />}
        {/* Cash tendered and change belong on the receipt: they are the two figures a patient
            checks at the counter, and the previous version showed neither. Only rendered at the
            point of sale — a reprint has no record of what was handed over. */}
        {isCash && tendered != null && (
          <>
            <Row label="Cash tendered" value={formatCurrency(tendered)} />
            <Row label="Change" value={formatCurrency(change || 0)} strong />
          </>
        )}
      </div>

      <Rule />

      <footer className="space-y-1 text-center">
        <p className="m-0 text-[10px] leading-snug text-slate-600">
          Thank you. Please keep this receipt — it is required for any refund, and for claiming
          your results.
        </p>
        {!hasStatutoryIdentity(CLINIC) && (
          // Said plainly rather than dressed up. A document that looks like a BIR Official
          // Receipt but is not one is worse than one that admits what it is.
          <p className="m-0 text-[9px] leading-snug text-slate-400">
            This is a payment acknowledgement, not a BIR-registered Official Receipt.
          </p>
        )}
        <p className="m-0 text-[9px] text-slate-400">
          Printed {new Date().toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      </footer>
    </div>
  );
};

export default Receipt;
