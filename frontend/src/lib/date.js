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
