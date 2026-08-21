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
 * Two passes, in order of how much they know.
 *
 * Existing reversed rows originally all got `refunded_at = paid_at` — the conservative guess,
 * because it reproduces exactly the behaviour those rows already had, so no historical figure
 * moves when this runs. `payments` has no `updated_at` to do better with, and that was recorded
 * here as a real gap rather than a solved problem.
 *
 * The gap is now closed for most rows. `audit_log` carries a `payment.refunded` /
 * `payment.cancelled` entry for every reversal since the audit hook landed, and its `created_at`
 * is the real moment the money went back — so the first pass reads the date out of the table that
 * genuinely recorded it. Only rows the audit trail cannot account for fall through to the guess,
 * and the script reports the two counts separately so the difference is never invisible.
 *
 * This also repairs the round-trip weakness noted when the column shipped: rolling back and
 * reapplying used to overwrite a true reversal date with `paid_at` permanently. The first pass
 * now recovers it from the audit trail, so the round trip is lossless wherever an entry exists.
 * `--rollback` still drops real timestamps for rows with no audit entry; it says so before doing
 * it. (The rollback drops the column, so ONLY the audit trail survives a round trip.)
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

  // The audit trail knows when each reversal actually happened, so ask it first.
  //
  // This originally backfilled every row with `refunded_at = paid_at` — the conservative guess,
  // chosen because it reproduces the pre-migration behaviour so no historical figure moves, and
  // recorded at the time as a real gap because `payments` has no `updated_at` to do better with.
  // But there IS something better: paymentService writes a `payment.refunded` / `payment.cancelled`
  // audit entry on every successful reversal, and `audit_log.created_at` is the real wall-clock
  // moment of the event. Reading it states nothing new — it moves a fact from the table that has
  // it to the table that needs it. Retention is not a constraint either: pruneAuditLog keeps
  // non-PHI actions ~7 years, far longer than any cash-up looks back.
  //
  // MIN(): the reversal endpoint is a check-then-act with no row lock, so two concurrent PATCHes
  // can both write and log. The FIRST entry is when it happened.
  const dated = await client.query(
    `UPDATE payments p
        SET refunded_at = a.at
       FROM (SELECT entity_id, MIN(created_at) AS at
               FROM audit_log
              WHERE entity_type = 'payment'
                AND action IN ('payment.refunded', 'payment.cancelled')
              GROUP BY entity_id) a
      WHERE p.id = a.entity_id
        AND p.payment_status = ANY($1)
        AND p.receipt_number IS NOT NULL
        -- NULL on a first run; equal to paid_at if an earlier run of THIS script already wrote
        -- the guess. Correcting that is the point — a fabricated date is not evidence, and the
        -- exact-equality test cannot catch a real reversal, which is never in the same
        -- microsecond as the payment it reverses.
        AND (p.refunded_at IS NULL OR p.refunded_at = p.paid_at)
        AND a.at IS DISTINCT FROM p.refunded_at`,
    [REVERSAL_STATUSES]
  );

  // Whatever the audit trail could not answer keeps the original conservative guess: reversals
  // predating the audit hook have no honest date, and `paid_at` at least reproduces exactly what
  // those rows reported before this migration, so no figure moves on their account.
  const guessed = await client.query(
    `UPDATE payments
        SET refunded_at = paid_at
      WHERE payment_status = ANY($1)
        AND receipt_number IS NOT NULL
        AND refunded_at IS NULL`,
    [REVERSAL_STATUSES]
  );

  logger.info(`  ~ ${dated.rowCount} reversal(s) dated from the audit trail`);
  logger.info(`  ~ ${guessed.rowCount} with no audit entry keep paid_at (no figure moves)`);

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
  // Say what is about to be lost. The audit trail can restore any reversal it recorded, so the
  // rows at risk are exactly the ones it cannot account for.
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM payments p
      WHERE p.refunded_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM audit_log a
                         WHERE a.entity_type = 'payment' AND a.entity_id = p.id
                           AND a.action IN ('payment.refunded', 'payment.cancelled'))`
  ).catch(() => ({ rows: [{ n: 0 }] }));
  if (rows[0].n > 0) {
    logger.warn(`  ! ${rows[0].n} reversal date(s) have no audit entry — reapplying cannot recover them`);
  }

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
