// Ages an E2E receipt so a spec can produce a cross-day reversal.
//
// Shells out to the backend rather than talking to Postgres from here, for the reason
// globalTeardown.js already gives: the credentials and the `pg` client live in the backend, and
// neither copying them into the frontend nor exposing a mutate-anything endpoint on the API is a
// trade worth making. The backend script refuses anything that is not an E2E-created receipt, so
// a mistake here cannot rewrite the date on a real payment.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * Moves a payment's `paid_at` back by `days`, and throws if it did not happen.
 *
 * Throws rather than warning: a spec that silently kept a same-day receipt would still pass,
 * because the same-day case works — it would just quietly stop testing the thing it is named
 * after, which is the failure mode this whole file exists to prevent.
 */
export function backdatePayment(paymentId, days = 1) {
  const backendDir = path.resolve(process.cwd(), '..', 'backend');
  const result = spawnSync(
    process.execPath,
    [path.join('src', 'scripts', 'e2eBackdatePayment.js'), `--payment=${paymentId}`, `--days=${days}`],
    { cwd: backendDir, encoding: 'utf8' }
  );

  if (result.error) throw new Error(`backdate could not run: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`backdate failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
}
