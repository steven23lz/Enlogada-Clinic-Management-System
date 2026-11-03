import { describe, it, expect } from 'vitest';
import {
  greeting, minutesBetween, listWords, waitingToPay, bookingState, todaysBookings,
  deskNeeds, NO_TESTS_SHOWN, tillNeeds, departmentNeeds, decisionNeed, failedNeed, backupNeed, timeLeft,
  topServices, hoursSoFar, departmentRows, nextSevenDays,
} from '../../src/lib/today.js';
import { formatTime12 } from '../../src/lib/date.js';

// 14 September 2026 is a Monday. Built from local parts so the tests hold in any time zone.
const at = (hour, minute = 0, day = 14) => new Date(2026, 8, day, hour, minute);
const iso = (hour, minute = 0) => at(hour, minute).toISOString();

describe('greeting', () => {
  it('turns at noon and at six', () => {
    expect(greeting(at(8))).toBe('Good morning');
    expect(greeting(at(11, 59))).toBe('Good morning');
    expect(greeting(at(12))).toBe('Good afternoon');
    expect(greeting(at(18))).toBe('Good evening');
  });
});

describe('minutesBetween', () => {
  it('is whole minutes, never negative, and null for nothing to measure', () => {
    expect(minutesBetween(iso(9, 0), at(9, 25, 14))).toBe(25);
    expect(minutesBetween(iso(10, 0), at(9, 0))).toBe(0);
    expect(minutesBetween(null, at(9))).toBeNull();
    expect(minutesBetween('not a date', at(9))).toBeNull();
  });
});

describe('listWords', () => {
  it('reads as a sentence', () => {
    expect(listWords([])).toBe('');
    expect(listWords(['the queue'])).toBe('the queue');
    expect(listWords(['a', 'b'])).toBe('a and b');
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('waitingToPay', () => {
  it("drops a visit paid today, keeps a refunded one, and lists the longest wait first", () => {
    const visits = [
      { id: 1, created_at: iso(9, 30) },
      { id: 2, created_at: iso(8, 10) },
      { id: 3, created_at: iso(8, 50) },
    ];
    const log = [
      { patient_visit_id: 1, payment_status: 'Paid' },
      // Reversed: the visit owes again, so it is back in the queue.
      { patient_visit_id: 3, payment_status: 'Refunded' },
    ];
    expect(waitingToPay(visits, log).map((v) => v.id)).toEqual([2, 3]);
  });
});

describe('bookingState', () => {
  const booking = (status, time = '10:30:00') => ({ status, scheduled_time: time });

  it('reads a checked-in booking as arrived, and says so for no-shows and cancellations', () => {
    expect(bookingState(booking('Confirmed'), at(9))).toBe('arrived');
    expect(bookingState(booking('Completed'), at(9))).toBe('arrived');
    expect(bookingState(booking('No Show'), at(9))).toBe('no-show');
    expect(bookingState(booking('Cancelled'), at(9))).toBe('cancelled');
  });

  it('is due until fifteen minutes past its slot, then late', () => {
    expect(bookingState(booking('Pending'), at(10, 0))).toBe('due');
    expect(bookingState(booking('Pending'), at(10, 45))).toBe('due');
    expect(bookingState(booking('Pending'), at(10, 46))).toBe('late');
  });
});

describe('todaysBookings', () => {
  it('leaves out cancellations and runs in slot order', () => {
    const rows = todaysBookings([
      { id: 1, status: 'Pending', scheduled_time: '14:00:00' },
      { id: 2, status: 'Cancelled', scheduled_time: '09:00:00' },
      { id: 3, status: 'Confirmed', scheduled_time: '08:30:00' },
    ], at(9));
    expect(rows.map((r) => [r.id, r.state])).toEqual([[3, 'arrived'], [1, 'due']]);
  });
});

describe('deskNeeds', () => {
  const visit = (id, over = {}) => ({
    id, first_name: 'Pat', last_name: `No${id}`, queue_number: `00${id}`, visit_status: 'Pending',
    created_at: iso(8, id), tests: [], ...over,
  });

  it('asks only about a waiting visit with nothing on it, and opens it for editing', () => {
    const rows = deskNeeds([
      visit(1),
      visit(2, { tests: [{ id: 9 }] }),
      visit(3, { visit_status: 'Processing' }),
    ], at(8, 31));
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Pat No1 has no tests yet');
    expect(rows[0].detail).toBe("Ticket 001 · waiting 30m · the cashier can't bill until there are");
    expect(rows[0].action).toMatchObject({ label: 'Add tests', go: 'reception-queue', intent: { editTests: 1, find: 'Pat No1' } });
  });

  it('sums up past a few, rather than pushing the rest of the page away', () => {
    const rows = deskNeeds([1, 2, 3, 4, 5].map((id) => visit(id)), at(9));
    expect(rows).toHaveLength(NO_TESTS_SHOWN + 1);
    expect(rows.at(-1).title).toBe('And 2 more with no tests yet');
  });
});

describe('tillNeeds', () => {
  it('says who has waited longest, and offers the check only to someone who may take the money', () => {
    const rows = tillNeeds({
      waiting: [{ first_name: 'Ben', last_name: 'Cruz', created_at: iso(8, 52) }],
      online: [{ first_name: 'Ana', last_name: 'Reyes', submitted_at: iso(8, 45) }],
      canCheck: false,
      now: at(10, 5),
    });
    expect(rows.map((r) => r.title)).toEqual(['1 patient waiting to pay', '1 online payment to check']);
    expect(rows[0].detail).toBe('Longest: Ben Cruz, 1h 13m');
    expect(rows[1].action).toBeUndefined();
    expect(tillNeeds({ waiting: [], online: [], now: at(10) })).toEqual([]);
  });

  // [1.146.0] A booking's time to pay ends at its appointment.
  it('says how many online payments are for an appointment within the hour', () => {
    const [row] = tillNeeds({
      online: [
        { first_name: 'Ana', last_name: 'Reyes', submitted_at: iso(8, 45), minutes_to_start: 20 },
        { first_name: 'Lia', last_name: 'Tan', submitted_at: iso(9, 0), minutes_to_start: 2000 },
        { first_name: 'Ken', last_name: 'Uy', submitted_at: iso(9, 5), minutes_to_start: null },
      ],
      canCheck: true,
      now: at(10, 5),
    });
    expect(row.title).toBe('3 online payments to check, 1 for an appointment within the hour');
  });
});

describe('departmentNeeds', () => {
  const pending = [
    { test_status: 'Processing', first_name: 'Dan', last_name: 'Villanueva', test_name: 'CBC', visit_created_at: iso(9, 24) },
    { test_status: 'Processing', first_name: 'Ana', last_name: 'Reyes', test_name: 'CBC', visit_created_at: iso(8, 40) },
    { test_status: 'Waiting for Release', first_name: 'Ana', last_name: 'Reyes', test_name: 'Urinalysis', visit_created_at: iso(8, 40) },
  ];

  it('is one worklist row with both halves of the work, oldest named', () => {
    const [row] = departmentNeeds({ category: 'Laboratory', pending, nav: 'lab-ops', now: at(10, 5) });
    expect(row.title).toBe('2 waiting for exam · 1 ready to release');
    expect(row.detail).toBe('Oldest: Ana Reyes, CBC, waiting 1h 25m');
    expect(row.action.go).toBe('lab-ops');
  });

  // [1.143.0] X-ray reports here again (from [1.129.0] it only marked exams done), so its
  // worklist has both halves of the work, like any other department's.
  it('counts an X-ray report waiting for release as a release, like any department', () => {
    const [row] = departmentNeeds({ category: 'Xray', pending, nav: 'xray-ops', now: at(10, 5) });
    expect(row.title).toBe('2 waiting for exam · 1 ready to release');
  });

  // [1.148.0] Past the department's target, when the clinic has set one, from when it was ready.
  it('says how many are past the target, and turns red', () => {
    const timed = pending.map((t) => ({ ...t, target_minutes: 60, ready_at: t.visit_created_at }));
    const [row] = departmentNeeds({ category: 'Laboratory', pending: timed, nav: 'lab-ops', now: at(10, 5) });
    expect(row.detail).toBe('2 tests past the 60-minute target. Oldest: Ana Reyes, CBC, waiting 1h 25m');
    expect(row.tone).toBe('rose');
    // No target set: measured, not judged.
    const [plain] = departmentNeeds({ category: 'Laboratory', pending, nav: 'lab-ops', now: at(10, 5) });
    expect(plain.tone).toBe('amber');
  });

  // [1.113.0] Emailing a released report is the patient's choice, so an unemailed one is not work.
  it('asks nothing of a department with an empty worklist', () => {
    expect(departmentNeeds({ category: 'Xray', pending: [], nav: 'xray-ops', now: at(10) })).toEqual([]);
  });
});

describe('decisionNeed and failedNeed', () => {
  it('name who is waiting, and what could not be checked', () => {
    const [decision] = decisionNeed([
      { patient_first_name: 'Carla', patient_last_name: 'Mendoza' },
      { patient_first_name: 'Mark', patient_last_name: 'Ong' },
      { patient_first_name: 'Rosa', patient_last_name: 'Lim' },
    ]);
    expect(decision.title).toBe('3 HMO requests waiting for your decision');
    expect(decision.detail).toBe('Carla Mendoza, Mark Ong and 1 more');
    expect(failedNeed(['the queue', 'online payments'])[0].title).toBe("Couldn't check the queue and online payments");
    expect(failedNeed([])).toEqual([]);
  });
});

// [1.148.0] A booking waits for its HMO claim only until its start: the soonest deadline first.
describe('decisionNeed deadlines', () => {
  it('names the soonest deadline and counts those within the hour', () => {
    const [decision] = decisionNeed([
      { patient_first_name: 'Mark', patient_last_name: 'Ong', decide_by: at(15).toISOString(), minutes_to_decide: 300 },
      { patient_first_name: 'Carla', patient_last_name: 'Mendoza', decide_by: at(10, 40).toISOString(), minutes_to_decide: 40 },
      { patient_first_name: 'Rosa', patient_last_name: 'Lim' },
    ], at(10));
    expect(decision.title).toBe('3 HMO requests waiting for your decision, 1 due within the hour');
    expect(decision.detail).toBe(`Soonest: Carla Mendoza, decide by ${formatTime12('10:40')} (40m left)`);
    expect(decision.tone).toBe('amber');
  });

  it('names another day by its weekday, and a passed deadline as time up', () => {
    const [later] = decisionNeed([
      { patient_first_name: 'Mark', patient_last_name: 'Ong', decide_by: at(9, 0, 15).toISOString(), minutes_to_decide: 1380 },
    ], at(10));
    expect(later.detail).toMatch(/^Soonest: Mark Ong, decide by \S+ 9:00 AM \(23h left\)$/);
    expect(later.tone).toBe('blue');
    expect(timeLeft(-3)).toBe('time is up');
    expect(timeLeft(null)).toBeNull();
  });
});

// [1.148.0] Said only when something is wrong: a working backup is not something to do.
describe('backupNeed', () => {
  const now = at(10);
  const hoursAgo = (h) => new Date(now.getTime() - h * 3600000).toISOString();

  it('says nothing while backups are working', () => {
    expect(backupNeed({ enabled: true, lastSuccessAt: hoursAgo(16) }, now)).toEqual([]);
    expect(backupNeed(undefined, now)).toEqual([]);
  });

  it('says when the newest is failing, why, and when the last good one was', () => {
    const [need] = backupNeed({
      enabled: true, lastSuccessAt: hoursAgo(40), lastFailureAt: hoursAgo(1),
      lastFailure: 'Backup failed: pg_dump was not found.',
    }, now);
    expect(need.id).toBe('backup');
    expect(need.tone).toBe('rose');
    expect(need.title).toBe('The backup is failing');
    expect(need.detail).toBe('pg_dump was not found. Last good backup: 1d 16h ago.');
    expect(need.action.go).toBe('activity');
  });

  it('says when it is off, never made, or more than a day and a half old', () => {
    expect(backupNeed({ enabled: false }, now)[0].title).toBe('Backups are turned off');
    // Left to the hosting company on purpose: not this server's to watch.
    expect(backupNeed({ enabled: false, byHost: true }, now)).toEqual([]);
    expect(backupNeed({ enabled: true }, now)[0].title).toBe('No backup has been made yet');
    expect(backupNeed({ enabled: true, lastSuccessAt: hoursAgo(50) }, now)[0].title).toBe('The last backup was 2d 2h ago');
    // A failure since put right is not a failure.
    expect(backupNeed({ enabled: true, lastSuccessAt: hoursAgo(1), lastFailureAt: hoursAgo(2) }, now)).toEqual([]);
  });
});

describe('topServices', () => {
  it('ranks by money as numbers, not as text', () => {
    // As strings, "900.00" sorts above "1250.00".
    const ranked = topServices([
      { test_name: 'CBC', net: '900.00' },
      { test_name: 'Whole Abdomen', net: '1250.00' },
      { test_name: 'Urinalysis', net: '90.00' },
    ], 2);
    expect(ranked.map((r) => r.test_name)).toEqual(['Whole Abdomen', 'CBC']);
  });
});

describe('hoursSoFar', () => {
  it('stops at the hour it is now', () => {
    const rows = [7, 8, 9, 10, 11].map((hour) => ({ hour, total: 1 }));
    expect(hoursSoFar(rows, at(9, 40)).map((r) => r.hour)).toEqual([7, 8, 9]);
  });
});

describe('departmentRows', () => {
  it('always lists the three departments, and measures nothing where nothing was released', () => {
    const rows = departmentRows({
      outstanding: [{ category_name: 'Laboratory', awaiting_exam: 2, awaiting_release: 1 }],
      byCategory: [{ category_name: 'Xray', released: 3, median_turnaround_minutes: 21 }],
      sla: [{ category_name: 'Xray', target_minutes: 30 }],
    });
    expect(rows.map((r) => r.category)).toEqual(['Laboratory', 'Ultrasound', 'Xray']);
    expect(rows[0]).toMatchObject({ awaitingExam: 2, awaitingRelease: 1, released: 0, medianMinutes: null });
    expect(rows[2]).toMatchObject({ released: 3, medianMinutes: 21, targetMinutes: 30 });
  });
});

describe('nextSevenDays', () => {
  const WEEK = [
    { dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
    ...[1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, isOpen: true, openTime: '08:00:00', closeTime: '17:00:00' })),
    { dayOfWeek: 6, isOpen: true, openTime: '08:00:00', closeTime: '12:00:00' },
  ];

  it('marks a date that differs from the usual week, and not a Sunday that is always closed', () => {
    const days = nextSevenDays(WEEK, [{ date: '2026-09-15', isOpen: false }], at(9));
    expect(days.map((d) => d.label).slice(0, 2)).toEqual(['Today', 'Tomorrow']);
    expect(days[0]).toMatchObject({ open: true, changed: false, text: `${formatTime12('08:00:00')} – ${formatTime12('17:00:00')}` });
    expect(days[1]).toMatchObject({ open: false, changed: true, text: 'Closed' });
    // Sunday the 20th: closed, as it always is.
    expect(days[6]).toMatchObject({ open: false, changed: false });
  });
});
