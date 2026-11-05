import { formatDuration } from './duration';
import { formatTime12, toDateInput } from './date';
import { paidVisitIds } from './collections';
import { categoryLabel, issuesReports } from './categories';
import { appointmentUrgency } from './paymentReview';
import { hoursOn } from './clinicStatus';
import { overTarget } from './turnaroundTarget';
import { formatCurrency } from './currency';
import { dayLabel } from './reportPrint';

/**
 * The rules behind the Today screens. [1.77.0]
 *
 * Every member of staff now signs in to Today: what needs them now, each with a button that does
 * something about it, and how the day is going. Steven chose it on the decisions page ("A and B":
 * Today first in every sidebar, and the screen staff land on). Nothing here fetches. The page reads
 * the endpoints the work screens already read, and these turn the answers into what it shows —
 * pure and clock-injected, so the thresholds are unit-tested rather than trusted
 * (tests/unit/today.test.js).
 *
 * A need is a DESCRIPTOR, not a component: `{ id, tone, icon, title, detail, action }`. Its action
 * says where it goes (`go`, with an `intent` for the screen it opens) or what it runs (`run`), so
 * the rules are testable without rendering and the page decides how to act on them.
 *
 * One rule shapes all of them: a fact appears once per screen. A need is something waiting on THIS
 * person; a figure is how the day is going. The same count is never both.
 */

/**
 * What a figure shows for one read: "…" until it answers, "—" if it failed, the value once it has.
 * Never 0 for a failure — a figure is a claim about the clinic. [1.74.0]
 */
export function figureValue(read, value) {
  if (read?.failed) return '—';
  if (read?.loading || read?.data === undefined) return '…';
  // Answered, but without this figure in it (a slice this account is not given): nothing to state.
  return value ?? '—';
}

/** Whole minutes from `since` to `now`, or null for a timestamp that does not parse. */
export function minutesBetween(since, now = new Date()) {
  if (!since) return null;
  const start = new Date(since).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.floor((now.getTime() - start) / 60000));
}

export function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export const personName = (row) => [row?.first_name, row?.last_name].filter(Boolean).join(' ');

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a", "a and b", "a, b and c". */
export function listWords(words = []) {
  const list = words.filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** A few names and how many more, for a need's second line. */
function someNames(names, shown = 2) {
  const list = names.filter(Boolean);
  const more = list.length - shown;
  return more > 0 ? `${list.slice(0, shown).join(', ')} and ${more} more` : list.join(', ');
}

const oldestFirst = (field) => (a, b) => new Date(a[field]) - new Date(b[field]);

const waitedFor = (since, now) => {
  const minutes = minutesBetween(since, now);
  return minutes === null ? null : formatDuration(minutes);
};

/** Who the till still has to charge, oldest first: the till's own rule (see paidVisitIds). */
export function waitingToPay(visits = [], transactions = []) {
  const paid = paidVisitIds(transactions);
  return visits.filter((v) => !paid.has(v.id)).sort(oldestFirst('created_at'));
}

/** How long after its slot a booking nobody has checked in reads as late rather than due. */
export const LATE_AFTER_MINUTES = 15;

/** 'arrived' | 'due' | 'late' | 'no-show' | 'cancelled' — a booking as the desk reads it now. */
export function bookingState(booking, now = new Date()) {
  switch (booking?.status) {
    case 'Confirmed':
    case 'Completed':
      return 'arrived';
    case 'No Show':
      return 'no-show';
    case 'Cancelled':
      return 'cancelled';
    default:
      break;
  }
  const [hours, minutes] = String(booking?.scheduled_time || '').split(':').map(Number);
  if (!Number.isFinite(hours)) return 'due';
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, Number.isFinite(minutes) ? minutes : 0);
  return now.getTime() - slot.getTime() > LATE_AFTER_MINUTES * 60000 ? 'late' : 'due';
}

/** Today's bookings in slot order, each with its state. A cancelled one is not coming, so it goes. */
export function todaysBookings(appointments = [], now = new Date()) {
  return appointments
    .filter((a) => a.status !== 'Cancelled')
    .map((a) => ({ ...a, state: bookingState(a, now) }))
    .sort((a, b) => String(a.scheduled_time).localeCompare(String(b.scheduled_time)));
}

/** How many visits with no tests get a row each before the rest are summed up. */
export const NO_TESTS_SHOWN = 3;

/**
 * The front desk's own work: a visit in the queue with nothing on it. The cashier cannot bill it and
 * no department will see it, so it waits for the desk and nobody else.
 */
export function deskNeeds(visits = [], now = new Date()) {
  const bare = visits
    .filter((v) => (v.visit_status || v.status) === 'Pending' && (v.tests || []).length === 0)
    .sort(oldestFirst('created_at'));

  const rows = bare.slice(0, NO_TESTS_SHOWN).map((v) => {
    const name = personName(v);
    const since = waitedFor(v.created_at, now);
    return {
      id: `no-tests-${v.id}`,
      tone: 'amber',
      icon: 'flask',
      title: `${name} has no tests yet`,
      detail: [
        v.queue_number && `Ticket ${v.queue_number}`,
        since && `waiting ${since}`,
        "the cashier can't bill until there are",
      ].filter(Boolean).join(' · '),
      action: {
        label: 'Add tests',
        ariaLabel: `Add tests for ${name}`,
        go: 'reception-queue',
        intent: { editTests: v.id, find: name },
      },
    };
  });

  const more = bare.length - NO_TESTS_SHOWN;
  if (more > 0) {
    rows.push({
      id: 'no-tests-more',
      tone: 'amber',
      icon: 'flask',
      title: `And ${more} more with no tests yet`,
      detail: 'The Desk lists every visit in the queue.',
      action: { label: 'Open the Desk', go: 'reception-queue' },
    });
  }
  return rows;
}

/** The till's work: people waiting to pay, and online payments waiting to be checked. */
export function tillNeeds({ waiting = [], online = [], canCheck = false, now = new Date() } = {}) {
  const rows = [];
  if (waiting.length) {
    const [oldest] = waiting;
    const since = waitedFor(oldest.created_at, now);
    rows.push({
      id: 'till',
      tone: 'blue',
      icon: 'receipt',
      title: `${count(waiting.length, 'patient')} waiting to pay`,
      detail: `Longest: ${personName(oldest)}${since ? `, ${since}` : ''}`,
      action: { label: 'Open the till', go: 'cashier-queue' },
    });
  }
  if (online.length) {
    const sorted = [...online].sort(oldestFirst('submitted_at'));
    const since = waitedFor(sorted[0].submitted_at, now);
    // [1.146.0] A booking's time to pay ends at its appointment, so these are the ones to do first.
    const urgent = online.filter((s) => ['soon', 'passed'].includes(appointmentUrgency(s).state)).length;
    rows.push({
      id: 'online',
      tone: 'amber',
      icon: 'wallet',
      title: `${count(online.length, 'online payment')} to check${urgent ? `, ${urgent} for an appointment within the hour` : ''}`,
      detail: [someNames(sorted.map(personName), 3), since && `the oldest was sent ${since} ago`]
        .filter(Boolean).join(' · '),
      action: canCheck ? { label: 'Check them', go: 'cashier-payments' } : undefined,
    });
  }
  return rows;
}

/**
 * A department's work: one row for its worklist, however many tests wait on it, because both
 * halves — the exam and the release — are done from the same screen.
 *
 * Released reports that were never emailed are NOT work [1.113.0]: emailing is the patient's
 * choice, made when they ask, so listing every unemailed report here would nag after each release.
 *
 * `labelled` names the department in the title, for someone who works more than one.
 */
export function departmentNeeds({
  category, pending = [], nav, labelled = false, now = new Date(),
} = {}) {
  const label = categoryLabel(category);
  const prefix = labelled ? `${label}: ` : '';
  const rows = [];

  if (pending.length) {
    // [1.129.0] A department that issues no report here (none since [1.143.0]) has one half, the exam, so a test
    // left 'Waiting for Release' from before is an exam still to mark done, not a report to release.
    const reports = issuesReports(category);
    const exam = pending.filter((t) => t.test_status === 'Processing'
      || (!reports && t.test_status === 'Waiting for Release')).length;
    const ready = reports ? pending.filter((t) => t.test_status === 'Waiting for Release').length : 0;
    const oldest = [...pending].sort(oldestFirst('visit_created_at'))[0];
    const since = waitedFor(oldest.visit_created_at, now);
    // [1.148.0] Past the department's turnaround target, when the clinic has set one.
    const late = overTarget(pending, now);
    rows.push({
      id: `worklist-${category}`,
      tone: late.length ? 'rose' : 'amber',
      icon: late.length ? 'alert' : 'clock',
      title: prefix + [exam && `${exam} waiting for exam`, ready && `${ready} ready to release`].filter(Boolean).join(' · '),
      detail: (late.length ? `${count(late.length, 'test')} past the ${late[0].target_minutes}-minute target. ` : '')
        + `Oldest: ${personName(oldest)}, ${oldest.test_name}${since ? `, waiting ${since}` : ''}`,
      action: { label: 'Open worklist', ariaLabel: `Open the ${label} worklist`, go: nav },
    });
  }
  return rows;
}

/** How soon an HMO claim must be decided, read like a payment proof's appointment. [1.148.0] */
export const decideUrgency = (request) => appointmentUrgency({ minutes_to_start: request?.minutes_to_decide });

/** "11:00 AM", or "Thu 9:00 AM" for another day: when a claim's booking stops waiting for it. */
export function deadlineLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const time = formatTime12(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString('en-PH', { weekday: 'short' })} ${time}`;
}

/** "40m left", or "time is up" once it has passed. */
export function timeLeft(minutes) {
  const n = Number(minutes);
  if (minutes === null || minutes === undefined || !Number.isFinite(n)) return null;
  return n < 0 ? 'time is up' : `${formatDuration(n)} left`;
}

/**
 * An Admin's decisions: HMO claims the front desk raised and only an Admin can settle.
 *
 * [1.148.0] A booking waits for its claim only until its own start ([1.132.0]), and is released if
 * still undecided then, so the soonest deadline is named and the ones within the hour counted, as
 * the till does for online payments ([1.146.0]).
 */
export function decisionNeed(requests = [], now = new Date()) {
  if (!requests.length) return [];
  const name = (r) => [r.patient_first_name, r.patient_last_name].filter(Boolean).join(' ');
  const timed = requests
    .filter((r) => decideUrgency(r).state !== 'none')
    .sort((a, b) => Number(a.minutes_to_decide) - Number(b.minutes_to_decide));
  const urgent = timed.filter((r) => ['soon', 'passed'].includes(decideUrgency(r).state)).length;
  const [soonest] = timed;
  return [{
    id: 'hmo-decisions',
    tone: urgent ? 'amber' : 'blue',
    icon: 'shield',
    title: `${count(requests.length, 'HMO request')} waiting for your decision${urgent ? `, ${urgent} due within the hour` : ''}`,
    detail: soonest
      ? `Soonest: ${name(soonest)}, decide by ${deadlineLabel(soonest.decide_by, now)} (${timeLeft(soonest.minutes_to_decide)})`
      : someNames(requests.map(name)),
    action: { label: 'Review', go: 'service-requests' },
  }];
}

/** How long before the clinic closes the till is reminded to count the drawer. */
export const COUNT_REMINDER_MINUTES = 30;

/**
 * The drawer. [1.150.0] An earlier day that took cash and was never counted comes first, because it
 * can only be counted for a week. Then today's, from half an hour before closing, because a count at
 * 09:00 is not the day's count. Nothing while it is done, or while no cash was taken.
 *
 * @param {{uncounted?: string[], todayCounted?: boolean, todayCash?: number}} status  /cash-counts/status
 * @param {{hours?: {week: object[], upcoming: object[]}|null, now?: Date}} options
 */
export function drawerNeed(status, { hours = null, now = new Date() } = {}) {
  if (!status) return [];
  const uncounted = status.uncounted || [];
  if (uncounted.length) {
    const [newest] = uncounted;
    return [{
      id: 'cash-count',
      tone: 'amber',
      icon: 'calculator',
      title: uncounted.length === 1
        ? `The drawer for ${dayLabel(newest)} was not counted`
        : `The drawer was not counted on ${uncounted.length} days`,
      detail: `A drawer can be counted up to 7 days later.${uncounted.length > 1 ? ` The latest is ${dayLabel(newest)}.` : ''}`,
      action: { label: 'Count it', go: 'cashier-count', intent: { countDate: newest } },
    }];
  }
  if (status.todayCounted || !(Number(status.todayCash) > 0) || !hours) return [];
  const today = hoursOn(now, hours.week, hours.upcoming);
  if (!today.open) return [];
  const [closeHour, closeMinute] = String(today.to).split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < closeHour * 60 + closeMinute - COUNT_REMINDER_MINUTES) return [];
  return [{
    id: 'cash-count',
    tone: 'blue',
    icon: 'calculator',
    title: "Count today's drawer",
    detail: `The till took ${formatCurrency(status.todayCash)} in cash today.`,
    action: { label: 'Count it', go: 'cashier-count' },
  }];
}

/** A backup older than this reads as missed: a day, and half a day's grace for a late start. */
export const BACKUP_STALE_HOURS = 36;

/**
 * Whether the clinic's records are being backed up. [1.148.0] Nothing to say while they are: a
 * working backup is not something to do. Said when it is off, failing, never made, or old.
 *
 * @param {{enabled: boolean, lastSuccessAt?: string, lastFailureAt?: string, lastFailure?: string}} status
 */
export function backupNeed(status, now = new Date()) {
  // BACKUPS=host: the hosting company backs the database up, and that is not this server's to watch.
  if (!status || (!status.enabled && status.byHost)) return [];
  const action = { label: 'Open the Activity Log', go: 'activity' };
  const success = status.lastSuccessAt ? new Date(status.lastSuccessAt) : null;
  const failure = status.lastFailureAt ? new Date(status.lastFailureAt) : null;
  const ago = success ? formatDuration(minutesBetween(success, now)) : null;
  const need = (tone, title, detail, withAction = true) => [{
    id: 'backup', tone, icon: 'backup', title, detail, ...(withAction ? { action } : {}),
  }];

  if (!status.enabled) {
    return need('amber', 'Backups are turned off', "Nothing is copying the clinic's records. Whoever runs the server turns them on (BACKUPS).", false);
  }
  if (failure && (!success || failure > success)) {
    const why = String(status.lastFailure || '').replace(/^Backup failed:\s*/, '');
    return need('rose', 'The backup is failing', `${why ? `${why} ` : ''}Last good backup: ${ago ? `${ago} ago` : 'none yet'}.`);
  }
  if (!success) {
    return need('amber', 'No backup has been made yet', 'The first is made a minute after the server starts.', false);
  }
  if (minutesBetween(success, now) > BACKUP_STALE_HOURS * 60) {
    return need('amber', `The last backup was ${ago} ago`, 'One is made every day. Is the server running in the evening?');
  }
  return [];
}

/**
 * No payment account published, so no patient can book online. [1.153.0] Told to whoever oversees the
 * clinic, and it is the SuperAdmin alone who can publish one, so an Admin is told who to ask and gets
 * no button for a screen it cannot open. Says nothing until the read has come back.
 *
 * @param {{open: boolean}|null} status  lib/onlineBooking.js
 * @param {{canPublish?: boolean}} [options]
 */
export function paymentAccountNeed(status, { canPublish = false } = {}) {
  if (!status || status.open) return [];
  return [{
    id: 'payment-account',
    tone: 'rose',
    icon: 'wallet',
    title: 'Patients cannot book online',
    detail: canPublish
      ? 'No payment account is published, so online booking is closed. Publish one to open it again.'
      : 'No payment account is published, so online booking is closed. Only the SuperAdmin can publish one: please ask them.',
    ...(canPublish ? { action: { label: 'Publish an account', go: 'superadmin', intent: { tab: 'payments' } } } : {}),
  }];
}

/**
 * What could not be checked, said once. Without it an empty list would read "nothing needs you"
 * over a request that failed — the most confident possible way to be wrong. [1.74.0]
 */
export function failedNeed(labels = []) {
  if (!labels.length) return [];
  return [{
    id: 'failed',
    tone: 'rose',
    icon: 'offline',
    title: `Couldn't check ${listWords(labels)}`,
    detail: 'So this list may be missing something. Refresh to try again.',
  }];
}

/** The best-selling services today, by what they actually brought in. */
export function topServices(byService = [], shown = 5) {
  return [...byService].sort((a, b) => Number(b.net) - Number(a.net)).slice(0, shown);
}

/** Arrivals up to the hour now, so the chart does not draw hours that have not happened as zeros. */
export function hoursSoFar(rows = [], now = new Date()) {
  return rows.filter((r) => Number(r.hour) <= now.getHours());
}

const DEPARTMENT_ORDER = ['Laboratory', 'Ultrasound', 'Xray'];

/**
 * One row per department for the clinic view: what waits there now, and how today went. The three
 * the clinic runs are always listed, so a quiet one reads as quiet rather than missing.
 */
export function departmentRows({ outstanding = [], byCategory = [], sla = [] } = {}) {
  const names = new Set(DEPARTMENT_ORDER);
  [...outstanding, ...byCategory, ...sla].forEach((r) => r?.category_name && names.add(r.category_name));
  const rank = (name) => (DEPARTMENT_ORDER.includes(name) ? DEPARTMENT_ORDER.indexOf(name) : DEPARTMENT_ORDER.length);

  return [...names]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => {
      const waiting = outstanding.find((r) => r.category_name === name) || {};
      const done = byCategory.find((r) => r.category_name === name) || {};
      const target = sla.find((r) => r.category_name === name) || {};
      const released = Number(done.released) || 0;
      return {
        category: name,
        awaitingExam: Number(waiting.awaiting_exam) || 0,
        awaitingRelease: Number(waiting.awaiting_release) || 0,
        released,
        // No release today means nothing was measured, which is not a turnaround of 0 minutes.
        medianMinutes: released > 0 ? Number(done.median_turnaround_minutes) : null,
        targetMinutes: target.target_minutes ?? null,
      };
    });
}

/**
 * Opening hours for today and the six days after it, with any date that differs from the usual
 * week marked — the question a patient on the phone is asking ("are you open Saturday?").
 */
export function nextSevenDays(week = [], upcoming = [], now = new Date()) {
  return Array.from({ length: 7 }, (_, ahead) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead);
    const hours = hoursOn(date, week, upcoming);
    const usual = hoursOn(date, week, []);
    return {
      key: toDateInput(date),
      label: ahead === 0 ? 'Today' : ahead === 1 ? 'Tomorrow' : date.toLocaleDateString('en-PH', { weekday: 'long' }),
      date: date.toLocaleDateString('en-PH', { day: 'numeric', month: 'short' }),
      open: hours.open,
      text: hours.open ? `${formatTime12(hours.from)} – ${formatTime12(hours.to)}` : 'Closed',
      changed: hours.open !== usual.open || hours.from !== usual.from || hours.to !== usual.to,
    };
  });
}
