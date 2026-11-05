/**
 * [1.163.0] visit_tests.overdue_notified_at: when the staff were told a test passed the clinic's turnaround
 * with no result, so each is told once. closing_notified_at: its last call before closing, once a day.
 * Tests already over get told once when the check next runs.
 *
 *   node src/scripts/migrateOverdueResults.js
 *   node src/scripts/migrateOverdueResults.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

(async () => {
  try {
    if (process.argv.includes('--rollback')) {
      await db.query('ALTER TABLE visit_tests DROP COLUMN IF EXISTS overdue_notified_at, DROP COLUMN IF EXISTS closing_notified_at');
      console.log('\n  Rolled back: overdue_notified_at is gone.\n');
    } else {
      await db.query('ALTER TABLE visit_tests ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMP');
      await db.query('ALTER TABLE visit_tests ADD COLUMN IF NOT EXISTS closing_notified_at TIMESTAMP');
      console.log('\n  Overdue results can be tracked.\n');
    }
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
})();
