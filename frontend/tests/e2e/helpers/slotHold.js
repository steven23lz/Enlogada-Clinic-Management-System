// Backend scripts the booking specs shell out to, for things no API should offer: lapsing a slot
// hold without waiting 15 minutes, and releasing the bookings a stopped run left behind. The
// spawning itself, and why it throws, is in backendScript.js.
import { runScript } from './backendScript.js';

const hold = (appointmentId, extra = []) =>
  runScript('e2eExpireHold.js', [`--appointment=${appointmentId}`, ...extra], 'slot-hold');

/**
 * Puts a booking into a live hold.
 *
 * A booking is only provisional when the payment gateway is configured — with no key the clinic
 * takes payment at the counter and the booking is permanent by design. So on a machine without
 * PAYMONGO_SECRET_KEY the state cannot be reached through the API at all, and the release
 * mechanism would go untested exactly where it is hardest to notice broken.
 */
export function holdSlot(appointmentId) {
  hold(appointmentId, ['--hold']);
}

/** Ends a live hold now, standing in for the fifteen minutes a spec cannot wait. */
export function expireHold(appointmentId) {
  hold(appointmentId);
}

/**
 * Releases the Pending, unpaid bookings the test accounts hold on a far-off test date. [1.72.0]
 *
 * A run stopped before its teardown leaves its bookings behind, and a fixed test date then runs out
 * of slots. This cancels them in the database, with no cancellation email per booking; the
 * script's guards keep it to test accounts, future dates, and bookings with no payment, result or
 * HMO claim. See backend/src/scripts/e2eReleaseTestDate.js.
 */
export function releaseLeftoverBookings(date) {
  return runScript('e2eReleaseTestDate.js', [`--date=${date}`, '--confirm'], 'release-test-date');
}
