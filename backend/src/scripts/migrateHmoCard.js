/**
 * Additive migration [1.13.0] — evidence for an HMO claim.
 *
 * An online booking can now state HMO coverage, so the clinic needs to see what the patient is
 * claiming against before an Admin approves it. A client attaches a photo of their HMO card; a
 * receptionist filing the same claim at the desk has the physical card in their hand instead, and
 * a photo would add nothing their own eyes did not already verify.
 *
 * Both are evidence, so both satisfy the same constraint: every hmo_requests row carries either a
 * card image, the id of the staff member who confirmed the card in person, or a record that its
 * image was later purged under the retention policy. That check is the
 * only layer no future route, script or hand-written INSERT can slip past — the service-layer
 * rule can only govern the code paths that exist today.
 *
 * The constraint is added NOT VALID on purpose. Rows created before this migration have neither
 * an image nor a verifier, and back-filling a staff id to satisfy the check would be inventing an
 * attestation nobody made. NOT VALID enforces the rule on every new and updated row while leaving
 * the historical ones honestly incomplete.
 *
 * Safe to re-run.
 *   node src/scripts/migrateHmoCard.js
 *
 * Reversible. This drops the columns and the constraint, and therefore the card metadata stored
 * in them — the image files under backend/uploads/hmo-cards/ are left on disk, so a rollback
 * followed by a re-run loses the links but not the evidence:
 *   node src/scripts/migrateHmoCard.js --rollback
 */
const db = require('../config/database');
const logger = require('../config/logger');

const steps = [
  {
    name: 'hmo_requests: add card_file_path (server-generated filename, never the client name)',
    sql: `ALTER TABLE hmo_requests ADD COLUMN IF NOT EXISTS card_file_path VARCHAR(255)`,
  },
  {
    name: 'hmo_requests: add card_original_name (what the patient called it, for download)',
    sql: `ALTER TABLE hmo_requests ADD COLUMN IF NOT EXISTS card_original_name TEXT`,
  },
  {
    name: 'hmo_requests: add card_mime_type',
    sql: `ALTER TABLE hmo_requests ADD COLUMN IF NOT EXISTS card_mime_type VARCHAR(100)`,
  },
  {
    name: 'hmo_requests: add card_size_bytes',
    sql: `ALTER TABLE hmo_requests ADD COLUMN IF NOT EXISTS card_size_bytes INT`,
  },
  {
    name: 'hmo_requests: add card_uploaded_at',
    sql: `ALTER TABLE hmo_requests ADD COLUMN IF NOT EXISTS card_uploaded_at TIMESTAMP`,
  },
  {
    name: 'hmo_requests: add card_verified_by (staff who confirmed the physical card at the desk)',
    sql: `ALTER TABLE hmo_requests ADD COLUMN IF NOT EXISTS card_verified_by INT REFERENCES users(id)`,
  },
  {
    name: 'hmo_requests: add card_verified_at',
    sql: `ALTER TABLE hmo_requests ADD COLUMN IF NOT EXISTS card_verified_at TIMESTAMP`,
  },
  {
    // Set when retention removes the image. Without it a purged card is indistinguishable from a
    // card never provided, and Admin cannot tell a policy working correctly from a missing record.
    name: 'hmo_requests: add card_purged_at (retention marker)',
    sql: `ALTER TABLE hmo_requests ADD COLUMN IF NOT EXISTS card_purged_at TIMESTAMP`,
  },
  {
    // Dropped and re-added rather than created only if absent, so re-running picks up a changed
    // definition instead of silently keeping an older one.
    name: 'hmo_requests: require evidence — a card image, a named staff verifier, or a purge record',
    sql: `ALTER TABLE hmo_requests DROP CONSTRAINT IF EXISTS chk_hmo_request_card_evidence`,
  },
  {
    // card_purged_at belongs in the check, not just alongside it. NOT VALID skips the initial
    // scan of historical rows but Postgres still enforces the constraint on every later UPDATE —
    // so without this arm, retention nulling card_file_path on a client-uploaded card (which has
    // no verifier by construction) violates the very constraint added to protect it, and the
    // purge dies partway through its loop.
    name: 'hmo_requests: add the evidence constraint',
    sql: `
      ALTER TABLE hmo_requests
        ADD CONSTRAINT chk_hmo_request_card_evidence
        CHECK (card_file_path IS NOT NULL OR card_verified_by IS NOT NULL OR card_purged_at IS NOT NULL)
        NOT VALID
    `,
  },
  {
    name: 'index card_verified_by for staff-attestation reporting',
    sql: `CREATE INDEX IF NOT EXISTS idx_hmo_requests_card_verified_by ON hmo_requests(card_verified_by)`,
  },
];

const rollbackSteps = [
  {
    name: 'drop the evidence constraint',
    sql: `ALTER TABLE hmo_requests DROP CONSTRAINT IF EXISTS chk_hmo_request_card_evidence`,
  },
  {
    name: 'drop idx_hmo_requests_card_verified_by',
    sql: `DROP INDEX IF EXISTS idx_hmo_requests_card_verified_by`,
  },
  {
    name: 'drop the card_* columns',
    sql: `
      ALTER TABLE hmo_requests
        DROP COLUMN IF EXISTS card_file_path,
        DROP COLUMN IF EXISTS card_original_name,
        DROP COLUMN IF EXISTS card_mime_type,
        DROP COLUMN IF EXISTS card_size_bytes,
        DROP COLUMN IF EXISTS card_uploaded_at,
        DROP COLUMN IF EXISTS card_verified_by,
        DROP COLUMN IF EXISTS card_verified_at,
        DROP COLUMN IF EXISTS card_purged_at
    `,
  },
];

async function main() {
  const rollback = process.argv.includes('--rollback');
  const plan = rollback ? rollbackSteps : steps;

  logger.info(rollback
    ? '[1.13.0] ROLLBACK — removing HMO card evidence columns…'
    : '[1.13.0] Adding HMO card evidence to hmo_requests…');

  // One transaction: a half-applied schema change is worse than none, and unlike the additive
  // column adds, the rollback's DROPs are genuinely destructive if they land piecemeal.
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const step of plan) {
      await client.query(step.sql);
      logger.info(`  ${rollback ? '-' : '+'} ${step.name}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    // Guarded: a ROLLBACK that itself throws would replace the real migration error.
    try {
      await client.query('ROLLBACK');
    } catch { /* the original error is the one worth reporting */ }
    client.release();
    throw err;
  }
  client.release();

  if (rollback) {
    logger.info('[1.13.0] Rolled back. Card images remain on disk under backend/uploads/hmo-cards/.');
    process.exit(0);
  }

  const counts = await db.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(card_file_path)::int AS with_image,
           COUNT(card_verified_by)::int AS with_verifier
    FROM hmo_requests
  `);
  const { total, with_image: withImage, with_verifier: withVerifier } = counts.rows[0];
  logger.info(`[1.13.0] Done. ${total} request(s): ${withImage} with an image, ${withVerifier} staff-verified.`);
  logger.info('        Pre-existing rows have neither; the constraint is NOT VALID so they are left as they are.');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
