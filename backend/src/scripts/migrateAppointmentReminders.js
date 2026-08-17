/**
 * Additive migration [1.25.0] — remembering who has already been reminded.
 *
 * `appointments.status` has carried 'No Show' since [1.0.0], which means the clinic was already
 * counting the problem and had no tool against it. A reminder the day before is the standard one,
 * and it is worth more here than in most booking systems: this is where the preparation
 * instruction actually lands. "Nothing to eat after 10pm tonight" is useful the evening before
 * and nearly useless at the moment of booking, three weeks earlier.
 *
 * One column, because the only thing a reminder job needs to remember is whether it has already
 * run for a given appointment. Without it the job is not safe to re-run — and a job that cannot
 * be re-run is one nobody dares schedule, so it would be run by hand, which is to say not at all.
 * Being able to run it twice an hour with no consequence is what makes it schedulable.
 *
 * NULL means "not yet reminded", which is the correct state for every existing row: back-filling
 * a timestamp would mark tomorrow's real appointments as already handled and suppress the first
 * night's reminders.
 *
 * Additive, idempotent, one transaction. Reversible:
 *   node src/scripts/migrateAppointmentReminders.js
 *   node src/scripts/migrateAppointmentReminders.js --rollback
 *
 * The rollback is safe: dropping it loses only the record of which reminders were sent, and the
 * worst consequence is that a patient is reminded twice.
 */
const db = require('../config/database');
const logger = require('../config/logger');

async function columnExists(table, column) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function migrate(client) {
  if (await columnExists('appointments', 'reminder_sent_at')) {
    logger.info('  = appointments.reminder_sent_at already present');
  } else {
    await client.query('ALTER TABLE appointments ADD COLUMN reminder_sent_at TIMESTAMP');
    logger.info('  + appointments: add reminder_sent_at (NULL = not yet reminded)');
  }

  // Partial, and it is the whole query the job runs: un-reminded appointments on a given date.
  // Most rows are historical and already reminded, so indexing them would be dead weight.
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_appointments_pending_reminder
    ON appointments (scheduled_date)
    WHERE reminder_sent_at IS NULL AND status = 'Pending'
  `);
  logger.info('  + index for the reminder sweep (partial — un-reminded, still Pending)');
}

async function rollback(client) {
  await client.query('DROP INDEX IF EXISTS idx_appointments_pending_reminder');
  logger.info('  - drop idx_appointments_pending_reminder');
  await client.query('ALTER TABLE appointments DROP COLUMN IF EXISTS reminder_sent_at');
  logger.info('  - drop appointments.reminder_sent_at');
  logger.info('    (safe: the worst consequence is a patient reminded twice)');
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(reversing
    ? '[1.25.0] ROLLBACK — removing appointment reminder tracking…'
    : '[1.25.0] Adding appointment reminder tracking…');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.25.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();

  logger.info(reversing ? '[1.25.0] Rolled back.' : '[1.25.0] Done. Schedule sendAppointmentReminders.js daily.');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.25.0] Migration failed: ${err.message}`);
  process.exit(1);
});
