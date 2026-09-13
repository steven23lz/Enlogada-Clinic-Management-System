// Runs a backend script from the frontend suite, for things no API should offer: lapsing a slot
// hold without waiting 15 minutes, releasing the bookings a stopped run left behind, or putting a
// known code on a test account's emailed code.
//
// Shelled out for the reason globalTeardown.js gives: the credentials and the `pg` client live in
// the backend. Each script refuses to run under NODE_ENV=production, and each is limited by what it
// may touch rather than by trusting its caller — see the scripts themselves.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** Throws rather than warning: a spec that silently skipped its setup would still pass, while
 *  quietly testing a different case from the one it names. */
export function runScript(script, args, label) {
  const backendDir = path.resolve(process.cwd(), '..', 'backend');
  const result = spawnSync(process.execPath, [path.join('src', 'scripts', script), ...args], {
    cwd: backendDir,
    encoding: 'utf8',
  });
  if (result.error) throw new Error(`${label} could not run: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result.stdout;
}
