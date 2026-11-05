/**
 * [1.165.0] Removes queue_calls. Steven took the waiting-room screen and the Call button out, as a future
 * recommendation in the paper, and this table only recorded who was called to it. A press of Call says nothing
 * about a patient's care and was kept for 30 days anyway, so nothing is archived.
 *
 *   node src/scripts/migrateRemoveQueueCalls.js
 *   node src/scripts/migrateRemoveQueueCalls.js --rollback    the table again, empty
 */

require('dotenv').config();
const db = require('../config/database');

async function apply() {
  await db.query('DROP TABLE IF EXISTS queue_calls');
  console.log('\n  queue_calls is gone.\n');
}

async function rollback() {
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
      )`);
    await db.query('CREATE INDEX IF NOT EXISTS idx_queue_calls_called_at ON queue_calls (called_at)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_queue_calls_visit ON queue_calls (patient_visit_id, station, called_at)');
  });
  console.log('\n  Rolled back: queue_calls is back, empty.\n');
}

(async () => {
  try {
    await (process.argv.includes('--rollback') ? rollback() : apply());
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
})();
