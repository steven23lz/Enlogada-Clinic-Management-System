/**
 * [1.148.0] Three emails the server now sends a patient by itself.
 *
 * Each is sent once, and the stamp below is how "once" is kept: the sweep CLAIMS a row by stamping
 * it before sending (two servers on one database still send it once), and a failed send gives the
 * stamp back to be tried again. See services/patientMessageService.js.
 *
 *   patient_visits.results_ready_emailed_at   "Your results are ready" (no report, no test name)
 *   patient_visits.feedback_invited_at        "How was your visit?", the day after it finished
 *   appointments.missed_notice_sent_at        a PAID booking nobody came for, the morning after;
 *                                             cleared when the booking is moved
 *
 *   node src/scripts/migratePatientMessages.js
 *   node src/scripts/migratePatientMessages.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

const COLUMNS = [
  ['patient_visits', 'results_ready_emailed_at'],
  ['patient_visits', 'feedback_invited_at'],
  ['appointments', 'missed_notice_sent_at'],
];

async function apply() {
  await db.withTransaction(async () => {
    for (const [table, name] of COLUMNS) {
      await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} TIMESTAMP`);
    }
  });
  console.log('\n  The patient email stamps are in place.\n');
}

async function rollback() {
  await db.withTransaction(async () => {
    for (const [table, name] of COLUMNS) {
      await db.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${name}`);
    }
  });
  console.log('\n  Rolled back. Turn the emails off too (PATIENT_EMAILS=off), or the server will fail its sweep.\n');
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
