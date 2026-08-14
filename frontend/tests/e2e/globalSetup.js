// Records when the run started, so the teardown knows which walk-in records the suite is
// responsible for. Walk-in patients are created by reception with no user account, so they carry
// no marker distinguishing them from real data — creation time is the only safe discriminator,
// and it is what keeps a demo dataset seeded beforehand from being swept up.
import fs from 'node:fs';
import path from 'node:path';

export const RUN_STAMP_FILE = path.join(process.cwd(), 'test-results', '.e2e-run-started');

export default function globalSetup() {
  fs.mkdirSync(path.dirname(RUN_STAMP_FILE), { recursive: true });
  fs.writeFileSync(RUN_STAMP_FILE, new Date().toISOString(), 'utf8');
}
