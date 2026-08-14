/**
 * Migration [1.18.0] — indexes for the columns every date-ranged screen filters on.
 *
 * These three columns carry the entire reporting suite, the cashier's transaction log and the
 * diagnostic history, and none of them had an index at all:
 *
 *   payments.paid_at        — findTransactions (every Cashier dashboard load), getRevenueTrend,
 *                             getPaymentMethodBreakdown, the statutory discount register
 *   visit_tests.created_at  — getServiceVolume
 *   test_results.released_at— getDiagnosticWorkload, findReleasedByCategory's sort
 *
 * Adding them alone would have changed nothing, because every one of those queries filtered on
 * `column::date BETWEEN …`. A B-tree index cannot serve a predicate on an *expression* — the
 * planner needs an index on exactly `column::date`, or a predicate on the bare column. So
 * `idx_patient_visits_created`, added back in [1.11.0] precisely for this, was never once used:
 * the active queue sequentially scanned every visit ever recorded, on every load.
 *
 * The queries were rewritten to half-open ranges (`col >= $1::date AND col < ($2::date + 1)`) in
 * the same change as this migration. That form is exactly equivalent, and it lets a plain B-tree
 * on the raw column apply. The two halves are useless apart, which is why they ship together.
 *
 * Why this matters more over time: `payments` grows fastest of any table here — at 200 payments a
 * day it passes 50,000 rows in the first year — and the cashier's transaction log reads it on
 * every dashboard load. A sequential scan is invisible on a demo dataset and gets steadily worse
 * in production, which is the failure mode nobody notices until it is already bad.
 *
 * Additive and safe to re-run. CREATE INDEX takes a brief lock on each table; these are small
 * enough that it is not worth the extra complexity of CONCURRENTLY, which cannot run inside the
 * implicit transaction this script uses anyway.
 *
 *   node src/scripts/migrateQueryPerformance.js
 */
const db = require('../config/database');
const logger = require('../config/logger');

const indexes = [
  {
    name: 'idx_payments_paid_at',
    reason: 'cashier transaction log, revenue trend, payment-method breakdown, discount register',
    sql: 'CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments (paid_at DESC)',
  },
  {
    name: 'idx_payments_status_paid_at',
    // Every one of those queries filters payment_status = 'Paid' as well as a date range, so the
    // composite serves the whole predicate rather than only half of it.
    reason: "the 'Paid' + date-range predicate those screens actually use",
    sql: `CREATE INDEX IF NOT EXISTS idx_payments_status_paid_at
          ON payments (payment_status, paid_at DESC)`,
  },
  {
    name: 'idx_visit_tests_created_at',
    reason: 'service-volume reporting',
    sql: 'CREATE INDEX IF NOT EXISTS idx_visit_tests_created_at ON visit_tests (created_at DESC)',
  },
  {
    name: 'idx_test_results_released_at',
    reason: "diagnostic workload reporting and the released-results list's sort",
    sql: `CREATE INDEX IF NOT EXISTS idx_test_results_released_at
          ON test_results (released_at DESC)`,
  },
  {
    name: 'idx_patient_visits_status_created',
    // findActiveVisits filters on both, every load, for both the front desk and the cashier.
    reason: 'the active queue: today + Pending/Processing',
    sql: `CREATE INDEX IF NOT EXISTS idx_patient_visits_status_created
          ON patient_visits (status, created_at)`,
  },
];

async function main() {
  logger.info('[1.18.0] Indexing the columns every date-ranged screen filters on…');

  for (const index of indexes) {
    await db.query(index.sql);
    logger.info(`  + ${index.name} — ${index.reason}`);
  }

  // ANALYZE so the planner has statistics for the new indexes immediately rather than after
  // autovacuum next happens to run. Without it the first queries may still choose a seq scan.
  for (const table of ['payments', 'visit_tests', 'test_results', 'patient_visits']) {
    await db.query(`ANALYZE ${table}`);
  }
  logger.info('  + statistics refreshed so the planner uses them straight away');

  logger.info('[1.18.0] Done.');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
