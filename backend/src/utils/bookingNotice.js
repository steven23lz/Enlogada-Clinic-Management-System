/**
 * How far ahead a booking must start. [1.144.0]
 *
 * Steven found a patient could book 11:00 at the very moment it was 11:00. The server refused a
 * slot whose start had passed (`m <= now`), but a booking made at 10:59 for 11:00 went through, and
 * a time grid opened before 11:00 kept offering 11:00 afterwards. A slot that starts a minute from
 * now is not one anybody can come to, and under payment first [1.123.0] it is worse: the patient
 * has an hour to pay, so the slot would start, and pass, while the booking is still unpaid.
 *
 * His rule: a booking needs an hour's notice. At 10:00 the earliest time is 11:00; at 10:01 it is
 * 11:30. It is the patient's time to pay (`PAY_WINDOW_MINUTES`, 60 by default), so the time to pay
 * always ends before the slot starts; the caller passes it in.
 *
 * Whole minutes, as the old "already passed" check counted: during 10:00 the 11:00 slot is still
 * an hour away. Pure: every function takes the moments it needs and reads no clock, so the rules
 * are tested in tests/unit/bookingNotice.test.js. Times are the server's local time, which is the
 * clinic's.
 */

/** Minutes since midnight of a Date, whole minutes. */
const minuteOfDay = (now) => now.getHours() * 60 + now.getMinutes();

/** Whether a slot starting at `slotMinute` today is closer than the notice allows. */
const isTooSoon = (slotMinute, nowMinute, noticeMinutes) => slotMinute < nowMinute + noticeMinutes;

/**
 * The first slot on the day's grid that is far enough ahead, or null when none is left today.
 *
 * @param {{ nowMinute: number, noticeMinutes: number, openMinutes: number, closeMinutes: number, interval: number }} day
 */
function earliestSlotToday({ nowMinute, noticeMinutes, openMinutes, closeMinutes, interval }) {
  const earliest = nowMinute + noticeMinutes;
  const steps = Math.max(0, Math.ceil((earliest - openMinutes) / interval));
  const slot = openMinutes + steps * interval;
  return slot < closeMinutes ? slot : null;
}

/** "1 hour", "2 hours", "90 minutes": the notice as a sentence says it. */
function noticeLabel(noticeMinutes) {
  if (noticeMinutes % 60 === 0) {
    const hours = noticeMinutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${noticeMinutes} minutes`;
}

module.exports = { minuteOfDay, isTooSoon, earliestSlotToday, noticeLabel };
