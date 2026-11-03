/**
 * When each of the server's own patient emails is due. [1.148.0]
 *
 * Pure: every function takes the moments it needs and reads no clock, so the rules are tested in
 * `tests/patientMessageTiming.test.js` rather than discovered on a patient's phone. The quiet hours
 * are the reminders' (utils/reminderTiming.js): nothing from 21:00 until 07:00.
 *
 * Each answers `{ action }`:
 *   'send'  due now
 *   'wait'  not yet (and `at`, when it is due)
 *   'skip'  too late to be any use; the sweep stamps it as handled and never looks again
 */
const { inQuietHours } = require('./reminderTiming');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const TIMING = Object.freeze({
  resultsWithinHours: 24,  // "your results are ready" said a day late is no longer news
  missedAtHour: 8,         // the morning after a missed booking
  missedWithinDays: 3,     // after that the desk has, or should have, called them
  feedbackAtHour: 10,      // the day after the visit finished
  feedbackWithinDays: 5,   // after that it reads as a form letter
});

/** `hour`:00 on the calendar day after `moment`, in the server's own time zone. */
function nextDayAt(moment, hour) {
  const d = new Date(moment);
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** A DATE value ("2026-11-03" or a Date at local midnight) as that day at local midnight. */
function dayStart(date) {
  if (date instanceof Date) return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Due from `due`, stale after `staleAfterMs`, never in quiet hours. */
function window(due, staleAfterMs, now) {
  const t = new Date(now);
  if (t < due) return { action: 'wait', at: due };
  if (t.getTime() - due.getTime() > staleAfterMs) return { action: 'skip', reason: 'too late' };
  if (inQuietHours(t)) return { action: 'wait', reason: 'quiet hours' };
  return { action: 'send' };
}

/** "Your results are ready": as soon as the visit's last result is out, within a day. */
function resultsReady({ completedAt, now }, o = TIMING) {
  return window(new Date(completedAt), o.resultsWithinHours * HOUR, now);
}

/** A paid booking nobody came for: the morning after its day. */
function missedBooking({ scheduledDate, now }, o = TIMING) {
  const due = nextDayAt(dayStart(scheduledDate), o.missedAtHour);
  return window(due, o.missedWithinDays * DAY, now);
}

/** "How was your visit?": the morning after the visit finished, unless it has been answered. */
function feedbackInvite({ completedAt, answered = false, now }, o = TIMING) {
  if (answered) return { action: 'skip', reason: 'already answered' };
  const due = nextDayAt(new Date(completedAt), o.feedbackAtHour);
  return window(due, o.feedbackWithinDays * DAY, now);
}

module.exports = { resultsReady, missedBooking, feedbackInvite, PATIENT_MESSAGE_TIMING: TIMING };
