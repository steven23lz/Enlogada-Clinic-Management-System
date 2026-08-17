/**
 * Additive migration [1.27.0] — why the HMO refused, and who wrote that down.
 *
 * `hmo_request_tests` recorded a per-test decision as one word: Pending, Approved or Rejected.
 * Nothing else. Not who decided it, not when, and — the one that costs the clinic every day —
 * not why.
 *
 * The rejection is the whole point of the record. An approval needs no explanation; the patient
 * pays nothing and leaves. A rejection is a conversation at the counter: the patient was told
 * their HMO covers an abdominal ultrasound, the claim came back refused, and they now owe 1,500
 * pesos they did not expect. The cashier has to explain that, and the reason lived only in
 * whatever the coordinator remembered or wrote on a printout. Three days later, when the patient
 * telephones to dispute it, nobody can answer.
 *
 * It also makes the decision unauditable in the way that matters. An HMO decision moves money
 * between the patient and the insurer, and until now the system could not say which member of
 * staff recorded it. Every other money-moving action here names its operator — a payment names
 * the cashier, a released result names the authoriser, a per-account permission change names the
 * SuperAdmin. This one did not.
 *
 * Three columns, all nullable, nothing back-filled:
 *   decision_reason  free text; required by the service on a rejection, ignored on an approval
 *   decided_by       the staff member who recorded it
 *   decided_at       when
 *
 * Nullable because rows decided before this migration genuinely have no answer, and inventing
 * one — stamping the migration's own timestamp, or attributing it to whoever ran the script —
 * would put a false statement in the audit trail. NULL reads as "decided before we recorded
 * this", which is true.
 *
 * Additive, idempotent, one transaction. Reversible:
 *   node src/scripts/migrateHmoDecisionTrail.js
 *   node src/scripts/migrateHmoDecisionTrail.js --rollback
 *
 * The rollback DESTROYS the reasons — this column is their only home — so it counts and warns
 * first, like migrateTestPreparation.
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
  const add = async (column, ddl, description) => {
    if (await columnExists('hmo_request_tests', column)) {
      logger.info(`  = hmo_request_tests.${column} already present`);
      return;
    }
    await client.query(`ALTER TABLE hmo_request_tests ADD COLUMN ${ddl}`);
    logger.info(`  + hmo_request_tests: add ${column} (${description})`);
  };

  await add('decision_reason', 'decision_reason TEXT', 'why — required on a rejection');
  await add('decided_by', 'decided_by INT', 'which member of staff recorded it');
  await add('decided_at', 'decided_at TIMESTAMP', 'when');

  // Named constraint, added separately so re-running after a partial failure still lands it.
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'hmo_request_tests' AND constraint_name = 'fk_hmo_request_tests_decided_by'`
  );
  if (rows.length === 0) {
    await client.query(
      `ALTER TABLE hmo_request_tests
         ADD CONSTRAINT fk_hmo_request_tests_decided_by FOREIGN KEY (decided_by) REFERENCES users(id)`
    );
    logger.info('  + hmo_request_tests: fk decided_by -> users(id)');
  } else {
    logger.info('  = fk_hmo_request_tests_decided_by already present');
  }

  // The screen that will read these is "the claims still waiting on a decision", so the index
  // covers the pending case only. Decided rows are the overwhelming majority and are read one
  // claim at a time, by id.
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_hmo_request_tests_pending
       ON hmo_request_tests(hmo_request_id)
       WHERE approval_status = 'Pending'`
  );
  logger.info('  + idx_hmo_request_tests_pending (partial: undecided rows only)');
}

async function rollback(client) {
  const { rows } = await db
    .query('SELECT COUNT(decision_reason)::int AS n FROM hmo_request_tests')
    .catch(() => ({ rows: [{ n: 0 }] }));
  if (rows[0].n > 0) {
    logger.warn(`  ! ${rows[0].n} decision(s) have a recorded reason; this is their only copy`);
  }
  await client.query('DROP INDEX IF EXISTS idx_hmo_request_tests_pending');
  await client.query(
    'ALTER TABLE hmo_request_tests DROP CONSTRAINT IF EXISTS fk_hmo_request_tests_decided_by'
  );
  for (const column of ['decision_reason', 'decided_by', 'decided_at']) {
    await client.query(`ALTER TABLE hmo_request_tests DROP COLUMN IF EXISTS ${column}`);
    logger.info(`  - drop hmo_request_tests.${column}`);
  }
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(reversing
    ? '[1.27.0] ROLLBACK — removing the HMO decision trail…'
    : '[1.27.0] Recording why an HMO decision went the way it did…');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.27.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();

  if (reversing) {
    logger.info('[1.27.0] Rolled back.');
    process.exit(0);
  }

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE approval_status = 'Rejected')::int AS rejected,
            COUNT(decision_reason)::int AS with_reason
       FROM hmo_request_tests`
  );
  logger.info(
    `[1.27.0] Done. ${rows[0].total} decision row(s), ${rows[0].rejected} rejected, ` +
      `${rows[0].with_reason} with a reason.`
  );
  logger.info('        Nothing back-filled: a rejection decided before today has no honest answer,');
  logger.info('        and a manufactured one would be worse than an empty column.');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.27.0] Migration failed: ${err.message}`);
  process.exit(1);
});
