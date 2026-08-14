/**
 * Additive migration [1.11.0] — indexes on foreign keys and status columns.
 *
 * PostgreSQL indexes PRIMARY KEY and UNIQUE columns automatically, but NOT foreign keys. This
 * schema had three indexes in total, all added recently for specific features, which left every
 * join and every status filter on the busiest tables doing a sequential scan. It does not show on
 * a small dev database and it will not show on day one in production; it shows once a year of
 * visits has accumulated, as screens that were instant becoming slow all at once.
 *
 * Two kinds here:
 *   - Foreign keys. Every join walks these, and so does PostgreSQL when checking whether a parent
 *     row can be deleted — an unindexed FK makes each delete scan the whole child table.
 *   - Status columns. The active queue, billing queue and modality worklists all filter on
 *     status, which is the single most-run query shape in the app.
 *
 * Safe to re-run: every statement uses IF NOT EXISTS. Applied directly rather than via
 * migrateDb.js, which drops and recreates every table. schema.sql carries the same statements for
 * fresh installs.
 *
 *   node src/scripts/migrateIndexes.js
 */
const db = require('../config/database');
const logger = require('../config/logger');

const INDEXES = [
  // --- Foreign keys on the visit chain: patients -> visits -> tests -> results/payments -------
  ['idx_patients_user', 'patients(user_id)'],
  ['idx_patient_visits_patient', 'patient_visits(patient_id)'],
  ['idx_visit_tests_visit', 'visit_tests(patient_visit_id)'],
  ['idx_visit_tests_test', 'visit_tests(test_id)'],
  ['idx_test_results_visit_test', 'test_results(visit_test_id)'],
  ['idx_payments_visit', 'payments(patient_visit_id)'],
  ['idx_appointments_visit', 'appointments(patient_visit_id)'],
  ['idx_hmo_request_tests_request', 'hmo_request_tests(hmo_request_id)'],
  ['idx_hmo_request_tests_visit_test', 'hmo_request_tests(visit_test_id)'],
  ['idx_user_roles_user', 'user_roles(user_id)'],
  ['idx_user_roles_role', 'user_roles(role_id)'],
  ['idx_role_permissions_role', 'role_permissions(role_id)'],
  ['idx_notification_reads_event', 'notification_reads(event_id)'],
  ['idx_password_reset_tokens_user', 'password_reset_tokens(user_id)'],
  ['idx_tests_category', 'tests(category_id)'],

  // --- Status / lookup columns behind the queue screens ---------------------------------------
  ['idx_patient_visits_status', 'patient_visits(status)'],
  ['idx_visit_tests_status', 'visit_tests(status)'],
  ['idx_payments_status', 'payments(payment_status)'],
  ['idx_appointments_status', 'appointments(status)'],
  ['idx_appointments_scheduled', 'appointments(scheduled_date, scheduled_time)'],
  ['idx_patient_visits_created', 'patient_visits(created_at DESC)'],
  // Result release and per-staff workload reporting both group by these.
  ['idx_test_results_released_by', 'test_results(released_by)'],
  ['idx_notification_events_created', 'notification_events(created_at DESC)'],
];

async function main() {
  logger.info(`[1.11.0] Creating ${INDEXES.length} index(es) if absent…`);
  let created = 0;

  for (const [name, target] of INDEXES) {
    try {
      const before = await db.query('SELECT 1 FROM pg_indexes WHERE indexname = $1', [name]);
      await db.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${target}`);
      if (before.rowCount === 0) {
        created += 1;
        logger.info(`  + ${name}  ->  ${target}`);
      }
    } catch (err) {
      // A column that does not exist on this database is reported, not fatal — the rest still
      // apply, and a half-indexed schema is strictly better than none.
      logger.warn(`  ! ${name} skipped: ${err.message}`);
    }
  }

  logger.info(`[1.11.0] Done. ${created} index(es) created, ${INDEXES.length - created} already present.`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Index migration failed: ${err.message}`);
  process.exit(1);
});
