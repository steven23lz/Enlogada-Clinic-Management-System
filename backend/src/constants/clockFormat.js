/**
 * A clock time as a patient reads it, for backend-generated text. [1.36.0]
 *
 * Mirrors `frontend/src/lib/date.js` formatTime12 exactly, and exists because the two sides speak
 * to the same person: the screen says "9:30 AM" and the confirmation email said "09:30", so the
 * clinic appeared to be quoting two different times for one appointment.
 *
 * Display only. Every stored value stays 24-hour — `scheduled_time` is a Postgres TIME, the
 * availability grid emits "HH:MM", and the reschedule endpoint validates that shape — so this is
 * applied on the way into a sentence and never on the way into a query or a response field.
 *
 * Accepts "HH:MM" and "HH:MM:SS", because Postgres returns seconds and callers had been slicing
 * them off by hand.
 */
function formatTime12(value) {
  if (!value) return '';
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value));
  if (!match) return String(value);
  const hours = Number(match[1]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) return String(value);
  const suffix = hours < 12 ? 'AM' : 'PM';
  // 0 -> 12 AM, 12 -> 12 PM. `h % 12` alone renders both as "0".
  return `${hours % 12 === 0 ? 12 : hours % 12}:${match[2]} ${suffix}`;
}

module.exports = { formatTime12 };
