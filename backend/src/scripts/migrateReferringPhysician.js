/**
 * Additive migration [1.23.0] — the doctor who asked for the test.
 *
 * A diagnostic report is not a document the patient is the only reader of. It goes back to the
 * physician who ordered the test, and until now there was nowhere to record who that was: the
 * report named the clinic and the clinician who performed it, and simply had no line for the
 * person the findings were for.
 *
 * ── Where it is REQUIRED, and where it deliberately is not ────────────────────────────────────
 * Required on an HMO claim, because the LOA process runs through the referring physician and a
 * claim without one is difficult to reimburse. Required for the 'Private' patient type, because
 * that type means "referred by a private physician" at this clinic — a Private visit with no
 * referring physician is a contradiction in its own record, not a gap.
 *
 * NOT required for Self Pay, and that is a decision rather than an oversight. It leaves one case
 * knowingly unenforced: a self-paying walk-in can be given an X-ray with no requesting physician
 * on file. Diagnostic radiography is normally performed on a licensed physician's request, and
 * that is a radiation-safety matter which does not care who is paying — so if the clinic's DOH /
 * BHDT licensing says a request is mandatory, this rule is too narrow and the fix is a
 * `requires_referral` flag per test_categories row rather than anything payer-shaped. Recorded
 * here so it is a decision somebody can revisit, not a silence.
 *
 * Two columns, because a name alone does not identify a doctor. The PRC licence number is what an
 * HMO asks for and what makes "Dr. Santos" unambiguous.
 *
 * Additive, idempotent, one transaction. Reversible:
 *   node src/scripts/migrateReferringPhysician.js
 *   node src/scripts/migrateReferringPhysician.js --rollback
 *
 * ── The rollback DESTROYS DATA ────────────────────────────────────────────────────────────────
 * Unlike migrateHmoCard's, which drops columns whose files survive on disk, these two columns are
 * the only place the referring physician is stored. Dropping them discards every name recorded
 * since the migration ran, with nothing to restore from. Verified rather than assumed: rolling
 * back and re-applying reports "0 naming a referring physician" on a database that had several.
 * Take a dump first if the data matters.
 */
const db = require('../config/database');
const logger = require('../config/logger');

const COLUMNS = [
  ['referring_physician', 'VARCHAR(150)', 'the doctor who requested the test'],
  ['referring_physician_prc', 'VARCHAR(50)', 'PRC licence number, what an HMO asks for'],
];

async function columnExists(table, column) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function migrate(client) {
  for (const [name, type, why] of COLUMNS) {
    if (await columnExists('patient_visits', name)) {
      logger.info(`  = patient_visits.${name} already present`);
      continue;
    }
    await client.query(`ALTER TABLE patient_visits ADD COLUMN ${name} ${type}`);
    logger.info(`  + patient_visits: add ${name} (${why})`);
  }

  // Partial: the overwhelming majority of visits will have no referring physician, and an index
  // over a column that is mostly NULL is mostly dead weight. This one answers "which visits did
  // Dr. X send us", which is the question a clinic actually asks of this data.
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_patient_visits_referring_physician
    ON patient_visits (referring_physician)
    WHERE referring_physician IS NOT NULL
  `);
  logger.info('  + index referring_physician (partial — most visits have none)');
}

async function rollback(client) {
  // Said out loud before it happens, because these columns are the only copy: unlike the HMO card
  // rollback, whose images survive on disk, there is nothing to restore these names from.
  const { rows } = await db.query(`
    SELECT COUNT(referring_physician)::int AS n FROM patient_visits
  `).catch(() => ({ rows: [{ n: 0 }] }));
  if (rows[0].n > 0) {
    logger.warn(`  ! ${rows[0].n} recorded referring physician(s) will be permanently discarded`);
  }

  await client.query('DROP INDEX IF EXISTS idx_patient_visits_referring_physician');
  logger.info('  - drop idx_patient_visits_referring_physician');
  for (const [name] of COLUMNS) {
    await client.query(`ALTER TABLE patient_visits DROP COLUMN IF EXISTS ${name}`);
    logger.info(`  - drop patient_visits.${name}`);
  }
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(reversing
    ? '[1.23.0] ROLLBACK — removing referring physician columns…'
    : '[1.23.0] Adding the referring physician to patient_visits…');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.23.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();

  if (reversing) {
    logger.info('[1.23.0] Rolled back.');
    process.exit(0);
  }

  const { rows } = await db.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(referring_physician)::int AS with_physician
    FROM patient_visits
  `);
  logger.info(`[1.23.0] Done. ${rows[0].total} visit(s), ${rows[0].with_physician} naming a referring physician.`);
  logger.info('        Existing visits keep NULL — back-filling a doctor nobody named would invent a referral.');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.23.0] Migration failed: ${err.message}`);
  process.exit(1);
});
