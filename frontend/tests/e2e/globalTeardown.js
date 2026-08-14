// Deletes what the run created. See backend/src/scripts/purgeE2eData.js for how test data is
// recognised and why the run window matters.
//
// The purge runs in the backend process rather than here because the database credentials and the
// `pg` client live there; the frontend has neither, and giving it either — or exposing a
// delete-everything endpoint on the API for tests to call — would be a worse trade than shelling
// out once at the end of a run.
//
// Cleanup never fails the run. A suite that reports red because tidying up did not work sends
// people hunting for a bug in the feature they just wrote, so failures here are logged and
// swallowed. Set E2E_SKIP_PURGE=1 to keep the data for debugging a failure.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RUN_STAMP_FILE } from './globalSetup.js';

export default function globalTeardown() {
  if (process.env.E2E_SKIP_PURGE === '1') {
    console.log('[e2e] E2E_SKIP_PURGE=1 — leaving test data in place.');
    return;
  }

  let since;
  try {
    since = fs.readFileSync(RUN_STAMP_FILE, 'utf8').trim();
  } catch {
    console.warn('[e2e] No run stamp found; skipping purge.');
    return;
  }

  const backendDir = path.resolve(process.cwd(), '..', 'backend');
  const result = spawnSync(
    process.execPath,
    [path.join('src', 'scripts', 'purgeE2eData.js'), `--since=${since}`],
    { cwd: backendDir, encoding: 'utf8' }
  );

  if (result.error) {
    console.warn(`[e2e] Purge could not run (non-fatal): ${result.error.message}`);
    return;
  }
  // Report the FAILURE line in preference to the progress line. The first version of this printed
  // whichever "E2E purge" line came first, which was always the "found N rows" one — so a purge
  // that then crashed mid-way still looked like it had worked, and the leftovers went unnoticed.
  const output = `${result.stdout || ''}${result.stderr || ''}`.split('\n');
  const failure = output.find((l) => l.includes('purge failed'));
  const summary = failure || output.find((l) => l.includes('E2E purge'));
  if (summary) console.log(`[e2e] ${summary.trim()}`);
  if (failure) console.warn('[e2e] Test data was left behind — see the error above.');
}
