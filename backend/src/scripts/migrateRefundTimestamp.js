/**
 * Additive migration [1.30.0] — record WHEN a receipt was reversed, not just that it was.
 *
 * `payments` carried `refund_reason` but no timestamp, so a reversal had no date of its own and
 * the cash-up had nothing to bucket it by except `paid_at` — the day the money came IN. Reversing
 * a receipt from an earlier day therefore did two wrong things at once, both demonstrated against
 * the seeded data before this was written:
 *
 *     reversing a 550.00 receipt paid on the 19th, on the 20th
 *       19th  collected  4830.00 -> 4280.00      a printed report stops reconciling
 *       20th  reversed      0.00 ->    0.00      the day the drawer is short shows nothing
 *
 * The first is the worse of the two. Restating a closed day means yesterday's figure changes
 * after yesterday ended, so the cash-up sheet in the drawer and the screen disagree and neither
 * is wrong — there is simply no date on which the clinic can say what it took.
 *
 * ── The model this enables ──────────────────────────────────────────────────────────────────
 *
 * A period-based cash book, which is what a daily drawer actually is:
 *
 *     collected   money taken IN during the range          bucketed by paid_at
 *     reversed    money paid BACK during the range         bucketed by refunded_at
 *     net         collected - reversed
 *
 * Collections stop being restated: a receipt issued on the 19th counts on the 19th whatever
 * happens to it later, and the refund lands on the day it was actually handed over. Paid and
 * refunded on the same day nets to zero and reads as 550 in / 550 out rather than as nothing
 * having happened, which is why `reversed` is reported BESIDE `collected` and never subtracted
 * from it.
 *
 * ── Backfill ────────────────────────────────────────────────────────────────────────────────
 *
 * Existing reversed rows get `refunded_at = paid_at`. That is a guess and is deliberately the
 * conservative one: it reproduces exactly the behaviour those rows have today, so no historical
 * figure moves when this runs. `payments` has no `updated_at` to do better with. Rows reversed
 * from here on carry a real timestamp.
 *
 * Additive and idempotent. Reversible:
 *   node src/scripts/migrateRefundTimestamp.js
 *   node src/scripts/migrateRefundTimestamp.js --rollback
 */
const db = require('../config/database');
const logger = require('../config/logger');

const REVERSAL_STATUSES = ['Refunded', 'Cancelled'];

async function migrate(client) {
  await client.query(`
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP
  `);
  logger.info('  + payments.refunded_at');

  // Only rows that were actually reversed — a 'Cancelled' gateway session that never became a
  // receipt is not a reversal and must not acquire a date that implies one.
  const { rowCount } = await client.query(
    `UPDATE payments
        SET refunded_at = paid_at
      WHERE payment_status = ANY($1)
        AND receipt_number IS NOT NULL
        AND refunded_at IS NULL`,
    [REVERSAL_STATUSES]
  );
  logger.info(`  ~ backfilled ${rowCount} existing reversal(s) from paid_at (no figure moves)`);

  // The cash-up asks "what was reversed in this range", so the range predicate needs an index of
  // its own — paid_at's does not serve it. Partial, because the overwhelming majority of payments
  // are never reversed and there is no reason to carry them in this index.
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_refunded_at
        ON payments (refunded_at)
     WHERE refunded_at IS NOT NULL
  `);
  logger.info('  + idx_payments_refunded_at (partial)');
}

async function rollback(client) {
  await client.query('DROP INDEX IF EXISTS idx_payments_refunded_at');
  logger.info('  - idx_payments_refunded_at');
  await client.query('ALTER TABLE payments DROP COLUMN IF EXISTS refunded_at');
  logger.info('  - payments.refunded_at');
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(`[1.30.0] ${reversing ? 'Rolling back' : 'Applying'} refund timestamp…`);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.30.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM payments WHERE refunded_at IS NOT NULL`
  ).catch(() => ({ rows: [{ n: 0 }] }));
  logger.info(`[1.30.0] Done. ${rows[0].n} payment(s) carry a reversal timestamp.`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.30.0] Migration failed: ${err.message}`);
  process.exit(1);
});
