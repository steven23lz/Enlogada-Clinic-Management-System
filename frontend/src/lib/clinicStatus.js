import { formatTime12 } from './date';

/**
 * Whether the clinic is open right now, and what to tell the person looking. [1.76.0]
 *
 * For the staff sidebar's status line ("Open now · Until 5:00 PM today"). It reads the SAME public
 * schedule the booking calendar reads (`GET /schedule/public`): the weekly pattern Admin sets on
 * Clinic Schedule, and the dates that override it — a holiday closed, a half-day with changed
 * hours. A status typed anywhere else would drift from what patients are allowed to book.
 *
 * Pure and clock-injected, so the rules are unit-tested rather than trusted: the day after a
 * Saturday half-day is a Sunday the clinic is closed, and "opens tomorrow" is wrong there.
 */

const pad = (n) => String(n).padStart(2, '0');
const localYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * An override's date arrives as a plain date or as a full instant: node-postgres reads a DATE as
 * local midnight, which JSON then writes in UTC — "2026-09-14T16:00:00.000Z" for the 15th in
 * Manila. Read back through local getters, never by slicing the string, which is the toISOString
 * bug CLAUDE.md warns about.
 */
const dateKey = (value) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : localYmd(d);
};

const toMinutes = (time) => {
  const [h, m] = String(time || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : null;
};

/** The hours that apply on one date: an override for that date first, else the weekday's. */
export function hoursOn(date, week = [], upcoming = []) {
  const key = localYmd(date);
  const override = (upcoming || []).find((o) => dateKey(o.date) === key);
  if (override && override.isOpen === false) return { open: false };
  if (override && override.openTime && override.closeTime) {
    return { open: true, from: override.openTime, to: override.closeTime };
  }
  const day = (week || []).find((d) => d.dayOfWeek === date.getDay());
  if (!day || !day.isOpen || !day.openTime || !day.closeTime) return { open: false };
  return { open: true, from: day.openTime, to: day.closeTime };
}

/**
 * @returns {{ open: boolean, title: string, detail: string } | null}  null when there is no
 *   schedule to read — a failed request says nothing, rather than "Closed".
 */
export function clinicStatus(week, upcoming = [], now = new Date()) {
  if (!Array.isArray(week) || week.length === 0) return null;

  const minute = now.getHours() * 60 + now.getMinutes();
  const today = hoursOn(now, week, upcoming);

  if (today.open && minute >= toMinutes(today.from) && minute < toMinutes(today.to)) {
    return { open: true, title: 'Open now', detail: `Until ${formatTime12(today.to)} today` };
  }
  if (today.open && minute < toMinutes(today.from)) {
    return { open: false, title: 'Closed now', detail: `Opens ${formatTime12(today.from)} today` };
  }

  // Closed for the rest of today: find the next day it opens, a week ahead at most.
  const title = today.open ? 'Closed now' : 'Closed today';
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead);
    const hours = hoursOn(day, week, upcoming);
    if (hours.open) {
      const when = ahead === 1 ? 'tomorrow' : day.toLocaleDateString('en-PH', { weekday: 'long' });
      return { open: false, title, detail: `Opens ${formatTime12(hours.from)} ${when}` };
    }
  }
  return { open: false, title, detail: '' };
}
