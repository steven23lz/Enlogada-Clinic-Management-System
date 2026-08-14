/**
 * Additive migration [1.12.0] — separate who RECORDED a result from who RELEASED it.
 *
 * test_results had one actor column, released_by, and only the findings-upload path ever wrote
 * it. releaseResult() was handed the releasing user's id by its controller and silently dropped
 * it. So a column named "released by" actually recorded whoever last typed the findings, and the
 * moment those are two different people the record credits the wrong one.
 *
 * That is easy to miss while one person does both steps, and it is exactly wrong in the case the
 * workflow is built around: recording findings and authorising their release are deliberately
 * separate events — that is why 'Waiting for Release' exists as a state. A borrowed-role user can
 * write findings for a department, and the department's own staff authorises them. Both identities
 * are clinically meaningful, and the schema could only hold one.
 *
 * recorded_by is backfilled from released_by, which is accurate for every existing row: those
 * were all written by the upload path, so the value already IS the recorder. released_at is left
 * alone; it has always been set on insert, which for historic rows is the recording time.
 *
 * Safe to re-run.
 *   node src/scripts/migrateResultAttribution.js
 */
const db = require('../config/database');
const logger = require('../config/logger');

const steps = [
  {
    name: 'test_results: add recorded_by (findings author)',
    sql: `ALTER TABLE test_results ADD COLUMN IF NOT EXISTS recorded_by INT REFERENCES users(id)`,
  },
  {
    name: 'backfill recorded_by from released_by (historically the same person)',
    sql: `UPDATE test_results SET recorded_by = released_by WHERE recorded_by IS NULL`,
  },
  {
    name: 'test_results: add released_at_actual (when release was authorised)',
    // The existing released_at is set on INSERT, i.e. when findings were recorded. Rather than
    // redefine a column other code already reads, the authorisation timestamp gets its own.
    sql: `ALTER TABLE test_results ADD COLUMN IF NOT EXISTS authorised_at TIMESTAMP`,
  },
  {
    name: 'index recorded_by for per-staff workload reporting',
    sql: `CREATE INDEX IF NOT EXISTS idx_test_results_recorded_by ON test_results(recorded_by)`,
  },
];

async function main() {
  logger.info('[1.12.0] Separating result recording from result release…');
  for (const step of steps) {
    await db.query(step.sql);
    logger.info(`  + ${step.name}`);
  }
  const counts = await db.query(
    `SELECT COUNT(*)::int AS total, COUNT(recorded_by)::int AS with_recorder FROM test_results`
  );
  logger.info(`[1.12.0] Done. ${counts.rows[0].with_recorder}/${counts.rows[0].total} result(s) have a recorder.`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
