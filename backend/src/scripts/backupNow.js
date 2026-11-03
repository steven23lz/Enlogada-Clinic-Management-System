/**
 * Makes a backup now, whatever the schedule says. [1.148.0]
 *
 * The server makes one itself every day (jobs/backupScheduler.js, services/backupService.js), so
 * nothing needs scheduling. Run this before anything risky (a migration, a restore, moving the
 * clinic to another PC), or to check that backups work at all:
 *
 *   node src/scripts/backupNow.js
 *
 * Safe beside a running server: the two take turns on one lock. Where it goes and how to restore
 * it: docs/BACKUP_AND_RESTORE.md.
 */
require('dotenv').config();
const db = require('../config/database');
const backupService = require('../services/backupService');

(async () => {
  try {
    const result = await backupService.runNow();
    if (!result.ran) {
      console.log(`\n  Not made: ${result.why}. Try again in a minute.\n`);
    } else if (!result.ok) {
      console.error(`\n  Backup failed: ${result.error}\n`);
      process.exitCode = 1;
    } else {
      console.log(`\n  Backup made: ${result.file}`);
      console.log(`  ${(result.bytes / (1024 * 1024)).toFixed(1)} MB${result.encrypted ? ', encrypted' : ''}`
        + `${result.secondCopy ? ', second copy made' : ''}; ${result.uploads.copied} new uploaded file(s) copied.\n`);
    }
  } catch (err) {
    console.error('\n  Failed:', err.message, '\n');
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
