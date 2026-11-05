/**
 * [1.164.0] notification_events.target: what a notification is about, so clicking it opens that. Notices
 * already sent stay NULL, and read as they always did.
 *
 *   node src/scripts/migrateNotificationTargets.js
 *   node src/scripts/migrateNotificationTargets.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

(async () => {
  try {
    if (process.argv.includes('--rollback')) {
      await db.query('ALTER TABLE notification_events DROP COLUMN IF EXISTS target');
      console.log('\n  Rolled back: notifications open nothing again.\n');
    } else {
      await db.query('ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS target JSONB');
      console.log('\n  Notifications can open what they are about.\n');
    }
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
})();
