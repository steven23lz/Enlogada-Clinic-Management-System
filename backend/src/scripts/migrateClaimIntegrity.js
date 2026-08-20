/**
 * Additive migration [1.31.0] — one live claim per test, and a dead column removed.
 *
 * ── The constraint ──────────────────────────────────────────────────────────────────────────
 *
 * `uq_hmo_request_visit_test (hmo_request_id, visit_test_id)` stops a test appearing twice inside
 * ONE claim. Nothing stopped the same test being claimed by two DIFFERENT requests, and
 * `hmoService.createRequest` does not check either — so two Pending claims, or a Pending beside
 * an Approved, were reachable through the ordinary UI.
 *
 * That is not a cosmetic problem. `paymentRepository.getBillingSummary` reads a test's coverage
 * with a correlated subquery *specifically* to survive it: a plain LEFT JOIN would duplicate the
 * line item and silently inflate the bill subtotal. The schema permitted a state the biller had
 * to defend itself against at read time, which is the wrong place to solve it.
 *
 * The rule is deliberately NOT "one claim per test, ever". If a provider refuses, re-claiming the
 * same test with a second provider is legitimate and is exactly what a patient with two cards
 * would expect. So the index is partial on the live statuses:
 *
 *     at most one hmo_request_tests row per visit_test where approval_status <> 'Rejected'
 *
 * Rejected rows are left free to accumulate, because each is a real decision with a reason and a
 * decider attached [1.27.0] and deleting that history to make room for a retry would throw away
 * the answer to "why is the patient being charged for this".
 *
 * The correlated subquery stays. A rejected claim and a live one can still coexist, so "exactly
 * one row per test" is still not something a JOIN can assume.
 *
 * ── The column ──────────────────────────────────────────────────────────────────────────────
 *
 * `test_results.file_url` was superseded by `file_path` when result files stopped being served
 * statically and started streaming through an authenticated, ownership-checked route. It has been
 * carried as a "nullable legacy fallback" since, and is populated in 0 of 42 rows here while still
 * being selected in four queries and branched on in resultService. Dead weight that reads as a
 * live alternative to whoever meets it next.
 *
 * Additive and idempotent. Reversible:
 *   node src/scripts/migrateClaimIntegrity.js
 *   node src/scripts/migrateClaimIntegrity.js --rollback
 *
 * The rollback restores the column but not its contents, which is honest rather than lossy: there
 * are no contents to restore.
 */
const db = require('../config/database');
const logger = require('../config/logger');

async function migrate(client) {
  const { rows } = await client.query(`
    SELECT visit_test_id, COUNT(*)::int AS live
      FROM hmo_request_tests
     WHERE approval_status <> 'Rejected'
     GROUP BY visit_test_id
    HAVING COUNT(*) > 1
  `);
  if (rows.length) {
    // Refuse rather than repair. Which of two live claims is the real one is a question for the
    // HMO coordinator, and picking one here would quietly decide who pays.
    throw new Error(
      `${rows.length} visit_test(s) already carry more than one live claim ` +
      `(ids: ${rows.map((r) => r.visit_test_id).join(', ')}). ` +
      'Reject the duplicates in the UI first — this migration will not choose between them.'
    );
  }

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_hmo_one_live_claim_per_test
        ON hmo_request_tests (visit_test_id)
     WHERE approval_status <> 'Rejected'
  `);
  logger.info('  + uq_hmo_one_live_claim_per_test — one live claim per test, retries after a refusal still allowed');

  await client.query('ALTER TABLE test_results DROP COLUMN IF EXISTS file_url');
  logger.info('  - test_results.file_url — superseded by file_path, populated nowhere');
}

async function rollback(client) {
  await client.query('ALTER TABLE test_results ADD COLUMN IF NOT EXISTS file_url TEXT');
  logger.info('  + test_results.file_url (empty — it had no contents to restore)');
  await client.query('DROP INDEX IF EXISTS uq_hmo_one_live_claim_per_test');
  logger.info('  - uq_hmo_one_live_claim_per_test');
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(`[1.31.0] ${reversing ? 'Rolling back' : 'Applying'} claim integrity…`);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.31.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();
  logger.info('[1.31.0] Done.');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.31.0] Migration failed: ${err.message}`);
  process.exit(1);
});
