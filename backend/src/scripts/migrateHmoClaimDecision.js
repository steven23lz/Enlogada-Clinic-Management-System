/**
 * Additive migration [1.28.0] — deciding a whole claim, not just its individual tests.
 *
 * `hmo_requests.status` has allowed 'Rejected' since [1.0.0] and nothing could ever set it. The
 * only route was `PUT /request/:id/approve`, so a claim the provider turned down had two
 * outcomes available in practice: approve it anyway, or leave it Pending forever. The claims
 * worklist filters on Pending, so "leave it" means it sits at the top of the list being reopened
 * by every coordinator who scans it, indefinitely.
 *
 * That gap also broke the handoff the clinic actually runs on. Reception raises the claim, an
 * Admin or SuperAdmin decides it, and the cashier bills whatever is left — but the cashier was
 * never told a decision had happened. The patient waits in the lobby while the cashier reloads
 * the bill on a hunch, or bills them at full price because nothing said otherwise and the
 * approval lands an hour later.
 *
 * Three columns. Two mirror what [1.27.0] added to `hmo_request_tests`:
 *   decision_reason  free text; required by the service on a rejection, ignored on an approval
 *   decided_by       the Admin or SuperAdmin who recorded it
 *
 * The third is the patient's number with the provider:
 *   member_number    the identifier the HMO looks the claim up by
 *
 * That one had nowhere to live at all. The front desk photographs the card, and the number was
 * legible only by opening the image — so a coordinator on the phone to the provider had to fetch
 * a picture and read it off, and nothing could be searched by it. Worse, `pruneHmoCards.js`
 * deletes card images after 180 days by design, because they are insurance documents rather than
 * medical records. After that pass the claim's only member identifier was gone permanently,
 * while the claim itself is kept for seven years.
 *
 * No `decided_at`: `approved_date` already exists on this table and is the same fact. Adding a
 * second timestamp beside it would create two columns that must agree and eventually will not.
 *
 * Both nullable, nothing back-filled — a claim decided before today has no honest answer, and
 * inventing one puts a false statement in the audit trail.
 *
 * Additive, idempotent, one transaction. Reversible:
 *   node src/scripts/migrateHmoClaimDecision.js
 *   node src/scripts/migrateHmoClaimDecision.js --rollback
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
    if (await columnExists('hmo_requests', column)) {
      logger.info(`  = hmo_requests.${column} already present`);
      return;
    }
    await client.query(`ALTER TABLE hmo_requests ADD COLUMN ${ddl}`);
    logger.info(`  + hmo_requests: add ${column} (${description})`);
  };

  await add('decision_reason', 'decision_reason TEXT', 'why — required on a rejection');
  await add('decided_by', 'decided_by INT', 'the Admin or SuperAdmin who decided it');
  await add('member_number', 'member_number VARCHAR(100)', "the patient's number with the provider");

  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'hmo_requests' AND constraint_name = 'fk_hmo_requests_decided_by'`
  );
  if (rows.length === 0) {
    await client.query(
      `ALTER TABLE hmo_requests
         ADD CONSTRAINT fk_hmo_requests_decided_by FOREIGN KEY (decided_by) REFERENCES users(id)`
    );
    logger.info('  + hmo_requests: fk decided_by -> users(id)');
  } else {
    logger.info('  = fk_hmo_requests_decided_by already present');
  }

  // The claims worklist opens on the undecided ones — that is the whole point of the screen.
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_hmo_requests_pending
       ON hmo_requests(request_date DESC)
       WHERE status = 'Pending'`
  );
  logger.info('  + idx_hmo_requests_pending (partial: undecided claims, newest first)');
}

async function rollback(client) {
  const { rows } = await db
    .query('SELECT COUNT(decision_reason)::int + COUNT(member_number)::int AS n FROM hmo_requests')
    .catch(() => ({ rows: [{ n: 0 }] }));
  if (rows[0].n > 0) {
    logger.warn(`  ! ${rows[0].n} recorded reason(s)/member number(s); this is their only copy`);
  }
  await client.query('DROP INDEX IF EXISTS idx_hmo_requests_pending');
  await client.query('ALTER TABLE hmo_requests DROP CONSTRAINT IF EXISTS fk_hmo_requests_decided_by');
  for (const column of ['decision_reason', 'decided_by', 'member_number']) {
    await client.query(`ALTER TABLE hmo_requests DROP COLUMN IF EXISTS ${column}`);
    logger.info(`  - drop hmo_requests.${column}`);
  }
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(reversing
    ? '[1.28.0] ROLLBACK — removing the claim-level decision trail…'
    : '[1.28.0] Letting a whole claim be turned down, and saying why…');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.28.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();

  if (reversing) {
    logger.info('[1.28.0] Rolled back.');
    process.exit(0);
  }

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending
       FROM hmo_requests`
  );
  logger.info(`[1.28.0] Done. ${rows[0].total} claim(s), ${rows[0].pending} still undecided.`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.28.0] Migration failed: ${err.message}`);
  process.exit(1);
});
