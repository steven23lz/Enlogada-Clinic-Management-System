const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../config/logger');
const visitRepository = require('../repositories/visitRepository');
const auditService = require('./auditService');
const appointmentEmailService = require('./appointmentEmailService');

const ACTOR = 'System (unpaid, time up)';
const UPLOADS = path.join(__dirname, '..', '..', 'uploads');

const day = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
};

const WHY = {
  day_ended: (v) => `not paid by the end of ${day(v.created_at)}`,
  day_passed: (v) => `nobody came on ${day(v.scheduled_date)}, and it was not paid`,
  payment_window: () => 'not paid within its time to pay',
  hmo_undecided: () => 'its HMO had not approved it by the time it was booked for',
  // [1.146.0]
  proof_rejected_late: () => 'its payment proof was turned down after its appointment time',
  released_by_patient: () => 'the patient released it before paying',
};

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Keeps each payment proof of a removed visit on record. [1.146.0] Removing an unpaid visit deletes
 * its proofs with it, and a proof turned down for a blurry screenshot may still stand for money that
 * reached the clinic's account: the reference number is what a cashier matches it by.
 */
async function recordRemovedProofs(proofs, visits, actor) {
  for (const p of proofs) {
    const v = visits.find((x) => x.id === p.patient_visit_id) || {};
    await auditService.log({
      ...actor, action: 'payment_submission.kept_on_removal', entityType: 'visit', entityId: p.patient_visit_id,
      description: `Online payment ref ${p.reference_number} (${p.method || 'online'}, ${peso(p.amount_claimed)}, ${String(p.status).toLowerCase()}`
        + `${p.review_note ? `: "${p.review_note}"` : ''}) from ${v.first_name || ''} ${v.last_name || ''}`.trimEnd()
        + `, kept on record when the unpaid ${v.appointment_reference ? `booking ${v.appointment_reference}` : 'visit'} was removed. If this money arrived, take it at the till with this reference.`,
    });
  }
}

/**
 * Unpaid is temporary. [1.131.0]
 *
 * Steven: a booking is paid first, and a walk-in pays for its tests to go ahead; once paid there
 * are no takebacks. So nothing unpaid is ever "Cancelled" or a "No Show": when its time is up it is
 * removed (the rules are visitRepository.findExpiredUnpaid). The one record left is a line in the
 * Activity Log saying what was removed and why, and a patient whose booking is released is
 * emailed, since it simply disappears from their portal. Run every few minutes by
 * jobs/unpaidExpiryScheduler.js, so a lapsed time to pay frees its booking promptly.
 */
class UnpaidExpiryService {
  async removeExpired() {
    const { due, files } = await db.withTransaction(async () => {
      // Found inside the transaction that deletes, so what is removed is what was true at that
      // moment. A payment landing at the same instant blocks on the visit row and then fails the
      // delete, which rolls back and leaves it for the next sweep, by which time it is paid.
      const rows = await visitRepository.findExpiredUnpaid();
      const removed = await visitRepository.removeVisits(rows.map((r) => r.id));
      await recordRemovedProofs(removed.proofs, rows, { actorName: ACTOR });
      return { due: rows, files: removed.files };
    });
    if (!due.length) return { removed: 0, walkIns: 0, bookings: 0 };

    for (const f of files) {
      try { fs.unlinkSync(path.join(UPLOADS, f.dir, path.basename(f.p))); } catch { /* already gone */ }
    }

    for (const v of due) {
      const what = v.appointment_id
        ? `booking ${v.appointment_reference} for ${day(v.scheduled_date)}`
        : `walk-in visit${v.queue_number ? ` ticket ${v.queue_number}` : ''} of ${day(v.created_at)}`;
      const tests = (v.test_names || []).join(', ') || 'no tests';
      await auditService.log({
        actorName: ACTOR, action: 'visit.removed_unpaid', entityType: 'visit', entityId: v.id,
        description: `Removed the ${what} (${v.first_name} ${v.last_name}: ${tests}): ${WHY[v.why](v)}.`,
      });
      if (v.appointment_id && v.email) {
        appointmentEmailService.sendBookingReleased({
          to: v.email,
          patientName: `${v.first_name} ${v.last_name}`,
          reference: v.appointment_reference,
          date: v.scheduled_date,
          time: v.scheduled_time,
          why: v.why,
        }).catch((err) => logger.error(`Booking-released email failed for ${v.appointment_reference}: ${err.message}`));
      }
    }
    const bookings = due.filter((v) => v.appointment_id).length;
    return { removed: due.length, walkIns: due.length - bookings, bookings };
  }

  /**
   * Removes ONE unpaid booking now, with its Activity Log line and its proofs kept on record, and
   * no email: the caller has already told the patient, in the same words. [1.146.0] For a proof
   * turned down after the appointment time, and a booking the patient released themselves.
   *
   * @param {object} booking  a row with id, appointment_reference, scheduled_date, first_name, last_name, test_names
   * @param {{why: string, actorId?: number, actorName?: string}} how
   */
  async removeNow(booking, { why, actorId = null, actorName = null }) {
    const files = await db.withTransaction(async () => {
      const removed = await visitRepository.removeVisits([booking.id]);
      const actor = actorId ? { actorId } : { actorName: actorName || ACTOR };
      await recordRemovedProofs(removed.proofs, [booking], actor);
      await auditService.log({
        ...actor, action: 'visit.removed_unpaid', entityType: 'visit', entityId: booking.id,
        description: `Removed the booking ${booking.appointment_reference} for ${day(booking.scheduled_date)} (${booking.first_name} ${booking.last_name}: ${(booking.test_names || []).join(', ') || 'no tests'}): ${WHY[why](booking)}.`,
      });
      return removed.files;
    });
    for (const f of files) {
      try { fs.unlinkSync(path.join(UPLOADS, f.dir, path.basename(f.p))); } catch { /* already gone */ }
    }
  }
}

module.exports = new UnpaidExpiryService();
