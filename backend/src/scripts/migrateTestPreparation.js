/**
 * Additive migration [1.24.0] — what the patient has to do before the test.
 *
 * A Fasting Blood Sugar needs eight hours without food. A pelvic ultrasound needs a full bladder.
 * A patient booking either of those online was told neither, anywhere: not on the services page,
 * not while choosing tests, not on the confirmation, and not in an email — because no booking
 * email existed. They arrive unprepared, the test cannot be done, and the clinic rebooks them.
 *
 * That is the most expensive kind of defect in a clinic system, because the cost lands on
 * everybody at once: the patient loses a morning and their fare, the slot is wasted, and the
 * front desk absorbs the conversation. It is also the cheapest to fix — the information exists,
 * it simply had nowhere to live.
 *
 * `preparation` is free text rather than a code list on purpose. Preparation is written by
 * clinical staff in the words they already use with patients ("Nothing to eat or drink except
 * water for 8 hours before your appointment"), and any enum would be a worse fit the moment a
 * test needs something the list did not anticipate.
 *
 * NULL means "no preparation needed", which is the honest default for most Laboratory tests and
 * is why nothing is back-filled. An empty string would mean the same thing and read differently,
 * so the column is left NULL and the UI shows nothing at all rather than an empty instruction.
 *
 * Additive, idempotent, one transaction. Reversible:
 *   node src/scripts/migrateTestPreparation.js
 *   node src/scripts/migrateTestPreparation.js --rollback
 *
 * The rollback DESTROYS the instructions — this column is their only home. It counts and warns
 * first, like migrateReferringPhysician.
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
  if (await columnExists('tests', 'preparation')) {
    logger.info('  = tests.preparation already present');
    return;
  }
  await client.query('ALTER TABLE tests ADD COLUMN preparation TEXT');
  logger.info('  + tests: add preparation (what the patient must do beforehand; NULL = nothing)');
}

async function rollback(client) {
  const { rows } = await db
    .query('SELECT COUNT(preparation)::int AS n FROM tests')
    .catch(() => ({ rows: [{ n: 0 }] }));
  if (rows[0].n > 0) {
    logger.warn(`  ! ${rows[0].n} test(s) have preparation instructions; this is their only copy`);
  }
  await client.query('ALTER TABLE tests DROP COLUMN IF EXISTS preparation');
  logger.info('  - drop tests.preparation');
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(reversing
    ? '[1.24.0] ROLLBACK — removing test preparation instructions…'
    : '[1.24.0] Adding preparation instructions to tests…');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.24.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();

  if (reversing) {
    logger.info('[1.24.0] Rolled back.');
    process.exit(0);
  }

  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS total, COUNT(preparation)::int AS with_prep FROM tests'
  );
  logger.info(`[1.24.0] Done. ${rows[0].total} test(s), ${rows[0].with_prep} with instructions.`);
  logger.info('        Nothing back-filled — the clinic writes these in their own words.');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.24.0] Migration failed: ${err.message}`);
  process.exit(1);
});
