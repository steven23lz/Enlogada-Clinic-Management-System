/**
 * [1.149.0] The waiting-room "Now serving" screen: who each station has called.
 *
 * One table, `queue_calls`, one row per press of Call: which visit, to which station, who pressed
 * it and when. Only the visit's TICKET ever leaves it for the public screen, never a name.
 *
 * A call means nothing without its visit, so deleting the visit (an unpaid one whose time is up, the
 * demo reset, the test purge) takes its calls with it. The retention pass removes old ones.
 *
 *   node src/scripts/migrateQueueCalls.js
 *   node src/scripts/migrateQueueCalls.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

async function apply() {
  await db.withTransaction(async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS queue_calls (
        id SERIAL PRIMARY KEY,
        patient_visit_id INT NOT NULL,
        station VARCHAR(20) NOT NULL,
        called_by INT,
        called_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_queue_calls_visit FOREIGN KEY (patient_visit_id) REFERENCES patient_visits(id) ON DELETE CASCADE,
        CONSTRAINT fk_queue_calls_called_by FOREIGN KEY (called_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT chk_queue_calls_station CHECK (station IN ('Front Desk', 'Cashier', 'Laboratory', 'Ultrasound', 'Xray'))
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_queue_calls_called_at ON queue_calls (called_at)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_queue_calls_visit ON queue_calls (patient_visit_id, station, called_at)');
  });
  console.log('\n  queue_calls is in place.\n');
}

async function rollback() {
  await db.query('DROP TABLE IF EXISTS queue_calls');
  console.log('\n  Rolled back: queue_calls is gone, and with it the record of who was called.\n');
}

(async () => {
  try {
    if (process.argv.includes('--rollback')) await rollback();
    else await apply();
  } catch (err) {
    console.error('\n  Failed:', err.message, '\n');
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
