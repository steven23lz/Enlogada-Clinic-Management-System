const test = require('node:test');
const assert = require('node:assert/strict');
const { minuteOfDay, isTooSoon, earliestSlotToday, noticeLabel } = require('../../src/utils/bookingNotice');

// How far ahead a booking must start. [1.144.0] A weekday: 08:00 to 17:00, every 30 minutes.
const hm = (h, m = 0) => h * 60 + m;
const WEEKDAY = { openMinutes: hm(8), closeMinutes: hm(17), interval: 30 };
const HOUR = 60;

test("Steven's case: 11:00 is not bookable at 11:00, nor at 10:59", () => {
  assert.equal(isTooSoon(hm(11), hm(11), HOUR), true);
  assert.equal(isTooSoon(hm(11), hm(10, 59), HOUR), true);
});

test('an hour ahead is bookable: at 10:00 the earliest is 11:00', () => {
  assert.equal(isTooSoon(hm(11), hm(10), HOUR), false);
  assert.equal(earliestSlotToday({ nowMinute: hm(10), noticeMinutes: HOUR, ...WEEKDAY }), hm(11));
});

test('a minute past the hour moves the earliest to the next slot on the grid', () => {
  assert.equal(earliestSlotToday({ nowMinute: hm(10, 1), noticeMinutes: HOUR, ...WEEKDAY }), hm(11, 30));
  assert.equal(earliestSlotToday({ nowMinute: hm(10, 30), noticeMinutes: HOUR, ...WEEKDAY }), hm(11, 30));
});

test('before opening, the first slot an hour away; never before the clinic opens', () => {
  assert.equal(earliestSlotToday({ nowMinute: hm(6), noticeMinutes: HOUR, ...WEEKDAY }), hm(8));
  assert.equal(earliestSlotToday({ nowMinute: hm(7, 15), noticeMinutes: HOUR, ...WEEKDAY }), hm(8, 30));
});

test('nothing left today once the last slot is under an hour away', () => {
  // The last slot is 16:30.
  assert.equal(earliestSlotToday({ nowMinute: hm(15, 30), noticeMinutes: HOUR, ...WEEKDAY }), hm(16, 30));
  assert.equal(earliestSlotToday({ nowMinute: hm(15, 31), noticeMinutes: HOUR, ...WEEKDAY }), null);
  // Saturday closes at 12:00.
  assert.equal(earliestSlotToday({ nowMinute: hm(11), noticeMinutes: HOUR, openMinutes: hm(8), closeMinutes: hm(12), interval: 30 }), null);
});

test('whole minutes from the clock, as the clinic reads it', () => {
  assert.equal(minuteOfDay(new Date(2026, 9, 31, 10, 59, 59)), hm(10, 59));
  assert.equal(minuteOfDay(new Date(2026, 9, 31, 0, 0, 0)), 0);
});

test('the notice says itself in words', () => {
  assert.equal(noticeLabel(60), '1 hour');
  assert.equal(noticeLabel(120), '2 hours');
  assert.equal(noticeLabel(90), '90 minutes');
});
