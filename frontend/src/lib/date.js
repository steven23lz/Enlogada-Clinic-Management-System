/**
 * Date helpers for the clinic's LOCAL day.
 *
 * Four screens each defined their own `todayStr` as
 * `new Date().toISOString().slice(0, 10)`, which is the **UTC** date, not the local one. The
 * clinic runs in Philippine time (UTC+8), so between midnight and 08:00 every single day that
 * expression returns *yesterday*. The consequences are all silent and all wrong in the same
 * direction:
 *
 *   - the Admin overview's "Today's Revenue" shows yesterday's takings,
 *   - Visit History and Transaction History open on yesterday's range,
 *   - a receptionist arriving for an 08:00 shift can be looking at the previous day's numbers.
 *
 * Nothing errors, so it reads as a quiet morning rather than a bug. The backend has always been
 * consistent about this — Postgres CURRENT_DATE is the server's local date, and
 * appointmentService already had a local-date helper for exactly this reason — so the frontend
 * was also disagreeing with the very rows it was asking for.
 *
 * These build the string from local getters instead, which is what every caller meant.
 */

/** Today, as YYYY-MM-DD in the clinic's local timezone. */
export const todayStr = () => toDateInput(new Date());

/** N days before today, as YYYY-MM-DD local. */
export const daysAgoStr = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateInput(d);
};

/**
 * Formats a Date as the YYYY-MM-DD an <input type="date"> and the API both expect.
 *
 * Uses local getters rather than toISOString() — see the note above.
 */
export function toDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Whole years between a birthdate and today, or null when there is no usable date.
 *
 * Written out rather than done with a millisecond division: a year is not a fixed number of
 * milliseconds, and dividing by 365.25 puts somebody one day either side of their birthday into
 * the wrong year. That matters here because diagnostic reference ranges are banded by age, and
 * the bands have hard edges — a paediatric range and an adult one are different documents.
 *
 * Local getters throughout, per the rule at the top of this file: the API serialises a DATE as a
 * UTC instant, so a birthdate read with UTC getters is a day early everywhere east of Greenwich.
 */
export function ageFromBirthdate(value) {
  if (!value) return null;
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDelta = today.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) age -= 1;

  return age >= 0 && age < 130 ? age : null;
}

/**
 * A date and time, written the way the rest of this app writes dates. [1.28.0]
 *
 * Ten screens rendered timestamps with a bare `toLocaleString()`, which returns whatever the
 * browser is set to — "8/18/2026, 2:49:29 AM" on a US-locale machine, sitting on the same page
 * as "Aug 18, 2026" from the tables that pass explicit options. Two formats for the same fact,
 * decided by a setting nobody in the clinic knows they have.
 *
 * `undefined` for the locale is deliberate: the reader's own language and numerals still apply.
 * What is pinned is the SHAPE — a written month, so 08/09 is never read as the ninth of August
 * in one place and the eighth of September in another. The clinic is Philippine and its staff
 * read both conventions; a written month is the one form that cannot be misread.
 *
 * Seconds are dropped. They were shown on every audit row and no one has ever needed them to the
 * second; they made a column of timestamps harder to scan for no gain.
 */
export function formatDateTime(value, { seconds = false } = {}) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });
}

/** Just the date, same shape: "Aug 18, 2026". */
export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * An appointment's date, as the patient reads it. [1.29.0]
 *
 * Lifted out of ClientDashboard.jsx when the booking dialog was extracted — the page and the
 * dialog both need it, so it belongs to neither.
 *
 * The API always sends `scheduled_date` as a full ISO instant (pg parses the SQL DATE column with
 * the local-timezone constructor server-side, then JSON serialises that to UTC). `new Date(...)`
 * parses the instant correctly and toLocaleDateString converts it back to the browser's local
 * calendar date, so no manual timezone arithmetic is needed — and none should be added, which is
 * the whole reason this note travels with the function.
 */
export function formatAppointmentDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
