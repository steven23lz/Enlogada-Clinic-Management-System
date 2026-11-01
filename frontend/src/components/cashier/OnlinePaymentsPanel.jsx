import React, { useState } from 'react';
import LoadingState from '../ui/loading-state';
import { AlertTriangle, Check, Clock, Eye, History, ShieldAlert, Wallet, X } from 'lucide-react';
import { Panel, PanelHeader, PanelBody } from '../ui/panel';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ConfirmDialog } from '../ui/confirm-dialog';
import ProofReviewDialog from './ProofReviewDialog';
import AttachedFile from '../AttachedFile';
import DataBadge from '../ui/data-badge';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import EmptyState from '../ui/empty-state';
import { formatCurrency } from '../../lib/currency';
import { reviewConcerns, appointmentUrgency, URGENT_MINUTES } from '../../lib/paymentReview';
import { formatAppointmentDate, formatTime12 } from '../../lib/date';

/**
 * Online payments waiting for a cashier to look at the screenshot. [1.48.0]
 *
 * ── The two numbers ─────────────────────────────────────────────────────────────────────────
 *
 * Approving bills the visit's REAL total, not what the patient typed. A screenshot claiming ₱50
 * against a ₱1,450 visit, approved, records ₱1,450 as received — and the drawer is short ₱1,400
 * with nothing on any screen to explain it. So both figures sit side by side and a mismatch is
 * called out in words, because "1450.00" and "50.00" in adjacent columns is exactly the kind of
 * difference a tired eye slides over at the end of a shift.
 */

/** When the booking behind a payment starts, as the cashier reads it. [1.146.0] */
const appointmentLabel = (s) => (s.scheduled_date
  ? `${formatAppointmentDate(s.scheduled_date)} at ${formatTime12(String(s.scheduled_time).slice(0, 5))}`
  : '');

/** "25 min" / "1 h 10 min": how long until the appointment. */
const minutesLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

export default function OnlinePaymentsPanel({ review }) {
  // The whole submission, not just its id. [1.63.0] The review dialog shows the claim BESIDE the
  // evidence — reference, both amounts, the duplicate warning — so it needs the row, and passing
  // an id would mean re-finding it or fetching it again.
  const [reviewing, setReviewing] = useState(null);
  // [1.146.0] A booking's time to pay ends at its appointment, so these are checked first. The
  // server already lists them soonest first; this counts them and says why.
  const urgent = review.submissions.filter((s) => ['soon', 'passed'].includes(appointmentUrgency(s).state));

  return (
    <div className="space-y-5">
      <Panel className="overflow-hidden">
        <PanelHeader
          title="Online Payments to Verify"
          description="Patients who paid into the clinic's account and are waiting for their booking pass"
          icon={Wallet}
          actions={
            review.submissions.length > 0 ? (
              <span className="rounded-md bg-amber-100 px-2 py-1 text-fine font-semibold text-amber-800">
                {review.submissions.length} waiting
              </span>
            ) : null
          }
        />
        <PanelBody flush>
          {review.error ? (
            <EmptyState
              tone="error"
              compact
              title="Could not load the payment queue"
              description={review.error}
              action={<Button variant="outline" size="sm" onClick={review.reload}>Try again</Button>}
            />
          ) : review.loading ? (
            <LoadingState label="Loading payments to check…" />
          ) : review.submissions.length === 0 ? (
            <EmptyState
              compact
              title="Nothing waiting"
              description="Payments patients make online appear here for checking. The list refreshes on its own."
            />
          ) : (
            <>
            {urgent.length > 0 && (
              <p role="alert" data-testid="proofs-urgent" className="m-0 flex items-start gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-fine font-semibold text-amber-900">
                <Clock className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                <span>
                  {urgent.length === 1 ? '1 payment is' : `${urgent.length} payments are`} for an appointment
                  within {URGENT_MINUTES} minutes or already past. Check {urgent.length === 1 ? 'it' : 'these'} first:
                  a booking's time to pay ends when its appointment starts.
                </span>
              </p>
            )}
            <ul className="m-0 list-none divide-y divide-line p-0">
              {review.submissions.map((s) => {
                const { claimed, due, mismatch } = reviewConcerns(s);
                const busy = review.acting === s.id;
                const urgency = appointmentUrgency(s);

                return (
                  <li key={s.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 font-semibold text-slate-900">
                          {s.first_name} {s.last_name}
                        </p>
                        <p className="m-0 text-fine text-slate-500">
                          {s.method_label || s.method_kind || 'Online'} · ref{' '}
                          <DataBadge variant="reference" label="Payment reference">{s.reference_number}</DataBadge>
                          {/* Flagged on the ROW, not only inside the dialog: a cashier working a
                              queue should see which one needs a second look before choosing which
                              to open. */}
                          {Number(s.duplicate_count) > 0 && (
                            <span className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-rose-800 ring-1 ring-inset ring-rose-300">
                              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                              Reference reused
                            </span>
                          )}
                          {s.appointment_reference ? ` · ${s.appointment_reference}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-4 text-right">
                        <span>
                          <span className="block text-micro font-semibold uppercase tracking-[0.1em] text-slate-400">
                            Patient says
                          </span>
                          <span className={`block font-bold tabular-nums ${mismatch ? 'text-rose-600' : 'text-slate-900'}`}>
                            {formatCurrency(claimed)}
                          </span>
                        </span>
                        <span>
                          <span className="block text-micro font-semibold uppercase tracking-[0.1em] text-slate-400">
                            Visit owes
                          </span>
                          <span className="block font-bold tabular-nums text-slate-900">
                            {formatCurrency(due)}
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* When the appointment starts. [1.146.0] */}
                    {urgency.state !== 'none' && (
                      <p
                        data-testid="proof-appointment"
                        data-urgency={urgency.state}
                        className={`m-0 mt-2 flex items-start gap-1.5 text-fine font-semibold ${
                          urgency.state === 'passed' ? 'text-rose-700' : urgency.state === 'soon' ? 'text-amber-800' : 'text-slate-500'
                        }`}
                      >
                        <Clock className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                        <span>
                          Appointment {appointmentLabel(s)}
                          {urgency.state === 'soon' && ` · ${minutesLabel(urgency.minutes)} left to confirm it`}
                          {urgency.state === 'passed' && ' · its time has passed: turning this down releases the booking'}
                        </span>
                      </p>
                    )}

                    {/* Said in words, not left as two numbers to compare. */}
                    {mismatch && (
                      <p className="m-0 mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-fine font-semibold text-rose-800 ring-1 ring-inset ring-rose-200">
                        <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                        <span>
                          These do not match. Approving records {formatCurrency(due)} as received —
                          check the screenshot before you do.
                        </span>
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {/* Opens the evidence and the claim TOGETHER. The old viewer put the
                          screenshot on top of the two figures the cashier has to compare it
                          against, so they read the image, closed it, and then decided from a row
                          they were remembering rather than reading. Never disabled now: without a
                          proof there is still a reference and two amounts to weigh. */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReviewing(s)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Review
                      </Button>
                      {/* Asks. This used to POST on the click — the one irreversible action on
                          the panel, in the middle of three identical buttons repeated down a
                          stacked list. */}
                      <Button size="sm" loading={busy} onClick={() => review.askVerify(s)}>
                        <Check className="h-3.5 w-3.5" />
                        Verify &amp; issue receipt
                      </Button>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => review.askReject(s)}>
                        <X className="h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </PanelBody>
      </Panel>

      {/* What was decided, and by whom. A settled submission used to leave the system entirely, so
          "did we take that GCash payment yesterday?" had nowhere to look and the screenshot behind
          somebody else's decision could not be re-opened. The receipt lives in Transaction
          History; the evidence for it lives here. */}
      {review.reviewed.length > 0 && (
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Recently Reviewed"
            description="The last decisions made here, with the proof still attached"
            icon={History}
          />
          <PanelBody flush>
            <ul className="m-0 list-none divide-y divide-line p-0">
              {review.reviewed.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-note font-semibold text-slate-800">
                      {s.first_name} {s.last_name}
                    </span>
                    <span className="block text-fine text-slate-500">
                      ref <span className="font-mono">{s.reference_number}</span>
                      {s.reviewed_by_first_name ? ` · by ${s.reviewed_by_first_name} ${s.reviewed_by_last_name}` : ''}
                    </span>
                    {s.review_note && (
                      <span className="mt-0.5 block text-fine italic leading-relaxed text-slate-500">
                        “{s.review_note}”
                      </span>
                    )}
                  </span>
                  <span className="flex flex-shrink-0 items-center gap-2.5">
                    {s.receipt_number && (
                      <span className="font-mono text-fine text-slate-500">{s.receipt_number}</span>
                    )}
                    <Badge variant={s.status === 'Verified' ? 'default' : 'secondary'}>
                      {s.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!s.has_proof}
                      onClick={() => setReviewing(s)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Proof
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      )}

      {/* Decisions only on a Pending row. "Recently Reviewed" opens the same dialog, and offering
          Verify or Reject on one already settled is a button whose only possible answer is the
          server's "already verified". */}
      {reviewing && (
        <ProofReviewDialog
          submission={reviewing}
          onClose={() => setReviewing(null)}
          onVerify={reviewing.status === 'Pending' ? (sub) => { setReviewing(null); review.askVerify(sub); } : undefined}
          onReject={reviewing.status === 'Pending' ? (sub) => { setReviewing(null); review.askReject(sub); } : undefined}
          busy={review.acting === reviewing.id}
        />
      )}

      {/* ── Asking before the money moves ──────────────────────────────────────────────────
          The description restates the figure that will ACTUALLY be recorded, because that is the
          number the cashier is agreeing to and it is not necessarily the one on the screenshot
          they just read. Everything the queue row warned about is repeated here: a confirmation
          that drops the warning is a confirmation that launders it. */}
      {review.verifying && (() => {
        const { claimed, due, mismatch, duplicates, concerning } = reviewConcerns(review.verifying);
        const name = `${review.verifying.first_name} ${review.verifying.last_name}`;

        return (
          <ConfirmDialog
            open
            onOpenChange={(open) => { if (!open) review.dismissVerify(); }}
            title="Record this payment?"
            description={`${name} · reference ${review.verifying.reference_number}`}
            confirmLabel="Record payment"
            onConfirm={review.confirmVerify}
            loading={!!review.acting}
            confirmDisabled={(concerning && !review.verifyAck) || (review.verifying.discount_declared && !review.discountChecked)}
          >
            <div className="rounded-lg border border-line bg-sunken p-3">
              <p className="m-0 text-fine leading-relaxed text-ink-muted">
                This records{' '}
                <strong className="font-bold tabular-nums text-ink">{formatCurrency(due)}</strong>{' '}
                as received, issues a receipt and releases the visit. It cannot be undone: a receipt
                is final, and there are no refunds.
              </p>
            </div>

            {mismatch && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-700" aria-hidden="true" />
                <span className="text-fine leading-relaxed text-amber-900">
                  The patient claims <strong className="font-bold">{formatCurrency(claimed)}</strong>,
                  but this visit owes <strong className="font-bold">{formatCurrency(due)}</strong>. The
                  larger figure is the one recorded.
                </span>
              </div>
            )}

            {duplicates > 0 && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-2.5">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-rose-700" aria-hidden="true" />
                <span className="text-fine leading-relaxed text-rose-900">
                  This reference already appears on {duplicates} other{' '}
                  {duplicates === 1 ? 'record' : 'records'}. Make sure this is not the same transfer
                  being counted twice.
                </span>
              </div>
            )}

            {/* [1.146.0] A Senior Citizen / PWD discount the patient declared with the booking. The
                bill above is already discounted; this is where the ID behind it is checked, and the
                cashier who ticks is recorded as the one who granted it. */}
            {review.verifying.discount_declared && (
              <div data-testid="declared-discount" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-fine text-amber-900">
                <p className="m-0">
                  <strong>{review.verifying.discount_name} discount declared</strong>, ID{' '}
                  <span className="font-mono">{review.verifying.discount_id_number}</span>. Check the photo against the
                  patient&apos;s name. If the ID is not valid, reject the payment and remove the discount instead.
                </p>
                <AttachedFile
                  url={`/visits/${review.verifying.patient_visit_id}/discount-id`}
                  hasFile
                  noun="ID photo"
                  imageAlt="The ID photo the patient sent with the booking"
                  frameTitle="The ID photo the patient sent with the booking"
                  missing=""
                />
                <label className="flex cursor-pointer items-start gap-2 font-medium">
                  <Checkbox
                    className="mt-0.5"
                    checked={review.discountChecked}
                    onChange={(e) => review.setDiscountChecked(e.target.checked)}
                  />
                  <span>I have checked the ID photo, and it matches the patient.</span>
                </label>
              </div>
            )}

            {/* The graduated step. Only for submissions the screen has already objected to, so it
                stays meaningful — a tick demanded on every payment is a tick nobody reads. */}
            {concerning && (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-2.5">
                <Checkbox
                  className="mt-0.5"
                  checked={review.verifyAck}
                  onChange={(e) => review.setVerifyAck(e.target.checked)}
                />
                <span className="text-fine leading-relaxed text-ink">
                  I have checked the proof and mean to record{' '}
                  <strong className="font-bold tabular-nums">{formatCurrency(due)}</strong>.
                </span>
              </label>
            )}
          </ConfirmDialog>
        );
      })()}

      <ConfirmDialog
        open={!!review.rejecting}
        onOpenChange={(open) => { if (!open) review.dismissReject(); }}
        title="Reject this payment"
        description={review.rejecting && (() => {
          // [1.146.0] What turning it down will actually do, as the time to pay ends at the
          // appointment: it used to promise "can submit again" whatever the clock said.
          const r = review.rejecting;
          const name = `${r.first_name} ${r.last_name}`;
          const urgency = appointmentUrgency(r);
          if (urgency.state === 'passed') {
            return `The appointment (${appointmentLabel(r)}) has passed, so turning this down releases ${name}'s booking. If the money did reach the clinic, take it at the till when they come, as a walk-in, with reference ${r.reference_number}.`;
          }
          if (urgency.state !== 'none') {
            return `${name} is emailed your reason and has until ${formatTime12(String(r.scheduled_time).slice(0, 5))}${urgency.state === 'later' ? ` on ${formatAppointmentDate(r.scheduled_date)}` : ''}, the appointment time, to send a new proof or pay at the counter. If it isn't paid by then, the booking is released.`;
          }
          return `${name} is shown your reason and can submit again. Their visit stays unpaid.`;
        })()}
        confirmLabel="Reject payment"
        onConfirm={review.confirmReject}
        loading={!!review.acting}
      >
        <Textarea
          rows={3}
          value={review.rejectReason}
          onChange={(e) => review.setRejectReason(e.target.value)}
          placeholder="e.g. The screenshot shows ₱500 but this visit is ₱1,450."
          aria-label="Reason for rejecting"
        />
        {/* [1.146.0] An ID that is not valid takes the declared discount off, so the patient's next
            payment is for the full amount the portal then states. */}
        {review.rejecting?.discount_declared && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-2.5 text-fine text-ink">
            <Checkbox
              className="mt-0.5"
              checked={review.removeDiscount}
              onChange={(e) => review.setRemoveDiscount(e.target.checked)}
            />
            <span>
              The {review.rejecting.discount_name} ID is not valid: remove the discount, so the patient pays the full amount.
            </span>
          </label>
        )}
      </ConfirmDialog>
    </div>
  );
}
