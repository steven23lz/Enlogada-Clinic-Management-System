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
