const patientMessageRepository = require('../repositories/patientMessageRepository');
const feedbackRepository = require('../repositories/feedbackRepository');
const appointmentEmailService = require('./appointmentEmailService');
const { resultsReady, missedBooking, feedbackInvite } = require('../utils/patientMessageTiming');
const { missingMailConfig } = require('../config/email');
const logger = require('../config/logger');

/** After a failed send, the same email is not tried again for this long. */
const RETRY_AFTER_MS = 10 * 60 * 1000;
/** feedbackService PORTAL_WINDOW_DAYS: a visit can be rated in the portal for 30 days. */
const FEEDBACK_WINDOW_DAYS = 30;

const fullName = (first, last) => [first, last].filter(Boolean).join(' ');
const sameName = (r) => fullName(r.first_name, r.last_name).toLowerCase().replace(/\s+/g, ' ')
  === fullName(r.account_first_name, r.account_last_name).toLowerCase().replace(/\s+/g, ' ');

/**
 * Three emails the server sends a patient by itself. [1.148.0]
 *
 * Steven's list of what only happened if somebody remembered:
 *   - resultsReady    The portal has no bell ([1.49.0]), so a patient with an account learned their
 *                     results were out only by signing in to look. Sent when a visit's last result
 *                     is released: no report, no test name ([1.113.0]: reports go by email only when
 *                     asked for). Portal accounts only; a walk-in without one has nowhere to sign in.
 *   - missedBooking   A PAID booking nobody came for sat on the Desk's list until staff rang. The
 *                     morning after, the patient is told their payment stands and how to move it.
 *   - feedbackInvite  The portal's "How was your visit?" was seen only by patients who signed in
 *                     within 30 days. Asked once, the morning after the visit finished.
 *
 * When each is due is utils/patientMessageTiming.js. Each is CLAIMED before it is sent (the stamp
 * on the visit or booking), so two servers on one database send it once, and a failed send gives
 * the claim back to retry after ten minutes. Too late to help, or nobody to send it to: stamped as
 * handled, and never looked at again. jobs/patientMessageScheduler.js sweeps every five minutes.
 */
class PatientMessageService {
  constructor() {
    this.failedUntil = new Map();
  }

  /** Everything owed an email now, with what a sweep at `now` would do. Reads only. */
  async plan({ now = new Date() } = {}) {
    const [ready, missed, feedback, questions] = await Promise.all([
      patientMessageRepository.findResultsReadyCandidates(),
      patientMessageRepository.findMissedBookingCandidates(),
      patientMessageRepository.findFeedbackCandidates(FEEDBACK_WINDOW_DAYS),
      feedbackRepository.findQuestions({ activeOnly: true }),
    ]);
    return [
      ...ready.map((r) => ({
        kind: 'resultsReady', id: r.visit_id, row: r,
        decision: resultsReady({ completedAt: r.completed_at, now }),
      })),
      ...missed.map((r) => ({
        kind: 'missedBooking', id: r.id, row: r,
        decision: missedBooking({ scheduledDate: r.scheduled_date, now }),
      })),
      // No questions switched on, no form to fill in: nobody is asked.
      ...(questions.length ? feedback : []).map((r) => ({
        kind: 'feedbackInvite', id: r.visit_id, row: r,
        decision: feedbackInvite({ completedAt: r.completed_at, answered: r.answered, now }),
      })),
    ];
  }

  /** One sweep: sends what is due now. Does nothing while outbound mail is not configured. */
  async sweep(now = new Date()) {
    const counts = { sent: 0, noAddress: 0, skipped: 0, failed: 0 };
    const missing = missingMailConfig();
    if (missing.length > 0) return { ...counts, notConfigured: missing };

    for (const item of await this.plan({ now })) {
      const { action } = item.decision;
      if (action === 'wait') continue;
      const key = `${item.kind}:${item.id}`;
      if ((this.failedUntil.get(key) || 0) > now.getTime()) continue;
      if (!(await patientMessageRepository.claim(item.kind, item.id))) continue;

      if (action === 'skip') {
        counts.skipped += 1;
        continue;
      }
      try {
        const result = await this.send(item);
        if (result?.error) throw new Error(result.error);
        if (result?.skipped) counts.noAddress += 1;
        else counts.sent += 1;
        this.failedUntil.delete(key);
      } catch (err) {
        await patientMessageRepository.release(item.kind, item.id);
        this.failedUntil.set(key, now.getTime() + RETRY_AFTER_MS);
        counts.failed += 1;
        logger.warn(`Patient email (${item.kind} #${item.id}) failed; will try again: ${err.message}`);
      }
    }
    return counts;
  }

  send({ kind, row }) {
    if (kind === 'missedBooking') {
      return appointmentEmailService.sendMissedBooking({
        to: row.email,
        patientName: fullName(row.first_name, row.last_name),
        reference: row.appointment_reference,
        date: row.scheduled_date,
        time: row.scheduled_time,
        hasAccount: row.has_account,
      });
    }
    const message = {
      to: row.email,
      accountName: fullName(row.account_first_name, row.account_last_name) || fullName(row.first_name, row.last_name),
      patientName: fullName(row.first_name, row.last_name),
      visitDate: row.visit_date,
      forSelf: sameName(row),
    };
    return kind === 'resultsReady'
      ? appointmentEmailService.sendResultsReady(message)
      : appointmentEmailService.sendFeedbackInvite(message);
  }
}

module.exports = new PatientMessageService();
