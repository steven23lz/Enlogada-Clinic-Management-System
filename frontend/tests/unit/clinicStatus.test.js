import { describe, it, expect } from 'vitest';
import { clinicStatus, hoursOn } from '../../src/lib/clinicStatus.js';
import { formatTime12 } from '../../src/lib/date.js';

// The clinic's real pattern: weekdays 08:00-17:00, Saturday a half-day, Sunday closed.
const WEEK = [
  { dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
  ...[1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, isOpen: true, openTime: '08:00:00', closeTime: '17:00:00' })),
  { dayOfWeek: 6, isOpen: true, openTime: '08:00:00', closeTime: '12:00:00' },
];

// 14 September 2026 is a Monday. Built from local parts so the tests hold in any time zone.
const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute);

describe('clinicStatus', () => {
  it('is open inside the hours, and says until when', () => {
    expect(clinicStatus(WEEK, [], at(14, 10))).toEqual({
      open: true, title: 'Open now', detail: `Until ${formatTime12('17:00:00')} today`,
    });
  });

  it('before opening, says it opens later today', () => {
    const s = clinicStatus(WEEK, [], at(14, 7, 30));
    expect(s.open).toBe(false);
    expect(s.detail).toBe(`Opens ${formatTime12('08:00:00')} today`);
  });

  it('at closing time it is closed, and opens tomorrow', () => {
    const s = clinicStatus(WEEK, [], at(14, 17, 0));
    expect(s).toEqual({ open: false, title: 'Closed now', detail: `Opens ${formatTime12('08:00:00')} tomorrow` });
  });

  it('after the Saturday half-day, skips the closed Sunday to Monday', () => {
    const s = clinicStatus(WEEK, [], at(19, 13));
    expect(s.title).toBe('Closed now');
    expect(s.detail).toBe(`Opens ${formatTime12('08:00:00')} Monday`);
  });

  it('on a closed Sunday it is closed all day, and opens tomorrow', () => {
    expect(clinicStatus(WEEK, [], at(20, 10))).toEqual({
      open: false, title: 'Closed today', detail: `Opens ${formatTime12('08:00:00')} tomorrow`,
    });
  });

  it('a holiday closure beats the weekday pattern', () => {
    const upcoming = [{ date: '2026-09-15', isOpen: false, note: 'Holiday' }];
    const s = clinicStatus(WEEK, upcoming, at(15, 10));
    expect(s.open).toBe(false);
    expect(s.title).toBe('Closed today');
  });

  it('changed hours for one date are the hours that count that day', () => {
    const upcoming = [{ date: '2026-09-16', isOpen: true, openTime: '08:00:00', closeTime: '12:00:00' }];
    expect(clinicStatus(WEEK, upcoming, at(16, 11)).detail).toBe(`Until ${formatTime12('12:00:00')} today`);
    expect(clinicStatus(WEEK, upcoming, at(16, 13)).open).toBe(false);
  });

  it('reads an override dated as a full instant on the right local day', () => {
    // How a DATE column reaches the browser: local midnight, written in UTC.
    const upcoming = [{ date: new Date(2026, 8, 17).toISOString(), isOpen: false }];
    expect(hoursOn(at(17, 9), WEEK, upcoming).open).toBe(false);
    expect(hoursOn(at(18, 9), WEEK, upcoming).open).toBe(true);
  });

  it('says nothing without a schedule, rather than "Closed"', () => {
    expect(clinicStatus([], [], at(14, 10))).toBeNull();
    expect(clinicStatus(null, [], at(14, 10))).toBeNull();
  });
});
