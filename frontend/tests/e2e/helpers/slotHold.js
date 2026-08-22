// Lapses a booking's slot hold, so a spec can test abandonment without waiting 15 minutes.
//
// Shells out to the backend for the reason globalTeardown.js gives: the credentials and the `pg`
// client live there. The script refuses anything that is not an E2E booking, and refuses to run
// under NODE_ENV=production at all.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** Throws rather than warning: a spec that silently kept a live hold would still pass, while
 *  quietly testing the same-session case that was never broken. */
function run(appointmentId, extra = []) {
  const backendDir = path.resolve(process.cwd(), '..', 'backend');
  const result = spawnSync(
    process.execPath,
    [path.join('src', 'scripts', 'e2eExpireHold.js'), `--appointment=${appointmentId}`, ...extra],
    { cwd: backendDir, encoding: 'utf8' }
  );
  if (result.error) throw new Error(`slot-hold could not run: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`slot-hold failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
}

/**
 * Puts a booking into a live hold.
 *
 * A booking is only provisional when the payment gateway is configured — with no key the clinic
 * takes payment at the counter and the booking is permanent by design. So on a machine without
 * PAYMONGO_SECRET_KEY the state cannot be reached through the API at all, and the release
 * mechanism would go untested exactly where it is hardest to notice broken.
 */
export function holdSlot(appointmentId) {
  run(appointmentId, ['--hold']);
}

/** Ends a live hold now, standing in for the fifteen minutes a spec cannot wait. */
export function expireHold(appointmentId) {
  run(appointmentId);
}
