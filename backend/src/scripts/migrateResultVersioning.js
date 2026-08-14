/**
 * Migration [1.15.0] — result versioning, and critical-value flagging.
 *
 * Two separate clinical-safety failures that share one table, done together because they land in
 * the same two service methods.
 *
 * 1. A CORRECTION DESTROYED THE ORIGINAL.
 *    test_results carried UNIQUE(visit_test_id) and createResult was an `ON CONFLICT DO UPDATE`,
 *    so editing an already-released result overwrote findings, remarks and file metadata in
 *    place. A radiology report issued to a patient could be silently rewritten afterwards with
 *    nothing anywhere recording what it used to say. The audit log noted only *that* a correction
 *    happened, never what changed.
 *
 *    That is indefensible for a diagnostic report. The whole point of an amended report is that
 *    the original and the amendment both exist: the patient may have acted on the first one, and
 *    a referring physician certainly may have.
 *
 *    Each save now writes a NEW row with an incremented version. The previous row is marked
 *    is_current = FALSE and points at its replacement via superseded_by, so the chain is walkable
 *    in both directions. A partial unique index keeps "one current result per test" true, which
 *    is the invariant the old UNIQUE was really enforcing — every existing reader that expects a
 *    single row keeps working, provided it filters on is_current (they all now do).
 *
 * 2. A PANIC VALUE RELEASED EXACTLY LIKE A NORMAL ONE.
 *    A platelet count of 8 went out with the same silent "your results are ready" email as a
 *    routine CBC. No flag, no escalation, no record that anyone was told. is_critical lets the
 *    person writing the findings mark it, which routes an urgent notification to the front desk
 *    and administrators on release, and critical_acknowledged_* records the callback actually
 *    being made — the part that matters medico-legally is not the flag, it is the evidence that
 *    someone picked up a phone.
 *
 * Backfill is exact rather than assumed: every existing row is version 1 and current, because
 * until now only one row per test could exist at all.
 *
 * Additive and safe to re-run.
 *   node src/scripts/migrateResultVersioning.js
 */
const db = require('../config/database');
const logger = require('../config/logger');

const steps = [
  {
    name: 'test_results: version chain columns',
    sql: `
      ALTER TABLE test_results
        ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS superseded_by INT REFERENCES test_results(id),
        ADD COLUMN IF NOT EXISTS amendment_reason TEXT
    `,
  },
  {
    name: "notification_events: allow a 'critical' severity",
    // notification_events.type was CHECKed to ('info','success','warning') and
    // notificationService silently coerces anything else to 'info'. So the critical-result
    // escalation — the most urgent message this system can send — arrived in the bell looking
    // exactly like "New Appointment Booked". The coercion meant nothing errored and nothing was
    // lost, which is precisely why it would never have been noticed.
    sql: `
      DO $$
      BEGIN
        ALTER TABLE notification_events DROP CONSTRAINT IF EXISTS chk_notification_events_type;
        ALTER TABLE notification_events
          ADD CONSTRAINT chk_notification_events_type
          CHECK (type IN ('info', 'success', 'warning', 'critical'));
      END $$
    `,
  },
  {
    name: 'test_results: critical-value flag and callback record',
    sql: `
      ALTER TABLE test_results
        ADD COLUMN IF NOT EXISTS is_critical BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS critical_acknowledged_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS critical_acknowledged_by INT REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS critical_acknowledgement_note TEXT
    `,
  },
];

async function main() {
  logger.info('[1.15.0] Adding result versioning and critical-value flagging…');

  for (const step of steps) {
    await db.query(step.sql);
    logger.info(`  + ${step.name}`);
  }

  // The old UNIQUE(visit_test_id) is exactly what prevents a second version existing, so it has
  // to go — but only after the partial index that replaces it is in place, and only by its real
  // name, which differs between a database built from schema.sql and one built by migration.
  const uniques = await db.query(`
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'test_results'
      AND con.contype = 'u'
      AND att.attname = 'visit_test_id'
      AND array_length(con.conkey, 1) = 1
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_test_results_current_per_test
    ON test_results (visit_test_id) WHERE is_current
  `);
  logger.info('  + unique index: exactly one CURRENT result per test');

  for (const row of uniques.rows) {
    await db.query(`ALTER TABLE test_results DROP CONSTRAINT IF EXISTS ${row.conname}`);
    logger.info(`  - dropped ${row.conname} (blocked every version after the first)`);
  }
  if (uniques.rows.length === 0) {
    logger.info('  · no single-column UNIQUE on visit_test_id left to drop');
  }

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_test_results_visit_test_version
    ON test_results (visit_test_id, version DESC)
  `);
  logger.info('  + index for walking a result\'s version history');

  // Existing rows are unambiguous: the old UNIQUE meant only one row per test could ever exist,
  // so every one of them is version 1 and is the current version. No guessing required.
  const fixed = await db.query(
    `UPDATE test_results SET version = 1, is_current = TRUE
     WHERE version IS NULL OR is_current IS NULL`
  );
  const counts = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE is_current)::int AS current,
            COUNT(*) FILTER (WHERE is_critical)::int AS critical
     FROM test_results`
  );
  const { total, current, critical } = counts.rows[0];
  logger.info(
    `[1.15.0] Done. ${total} result(s): ${current} current, ${critical} flagged critical` +
      (fixed.rowCount ? `, ${fixed.rowCount} backfilled` : '')
  );
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
