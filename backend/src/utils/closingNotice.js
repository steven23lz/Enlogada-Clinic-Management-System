/**
 * The last call before closing. [1.163.0]
 *
 * Steven: a patient in the queue at 4:17 PM has until 5:17 PM by the one-hour rule, but the clinic closes at
 * 5:00 PM. So 15 minutes before closing (4:45 PM), every test still with no uploaded result pings its
 * department, whatever its own hour says. Closing time is that day's real one: a Saturday closes at noon, so
 * its last call is 11:45 AM. A closed day has none. Pure, so it is tested without a clock.
 *
 * @param {{ isOpen: boolean, closeMinutes?: number }} day  appointmentService.resolveDay's answer
 * @param {number} nowMinutes  minutes since midnight
 * @param {number} [notice]    how long before closing
 * @returns {{ inWindow: boolean, closesAt: string|null }}  closesAt as 'HH:MM', while in the window
 */
function closingWindow(day, nowMinutes, notice = 15) {
  if (!day?.isOpen || !Number.isFinite(day.closeMinutes)) return { inWindow: false, closesAt: null };
  const inWindow = nowMinutes >= day.closeMinutes - notice && nowMinutes < day.closeMinutes;
  if (!inWindow) return { inWindow: false, closesAt: null };
  const hours = String(Math.floor(day.closeMinutes / 60)).padStart(2, '0');
  const minutes = String(day.closeMinutes % 60).padStart(2, '0');
  return { inWindow: true, closesAt: `${hours}:${minutes}` };
}

module.exports = { closingWindow };
