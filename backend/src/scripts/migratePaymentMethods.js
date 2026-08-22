/**
 * Migration [1.33.0] — narrow chk_payment_method to the methods the clinic can actually settle.
 *
 * PayMaya was offered at the counter and online. The clinic owner holds no PayMaya merchant
 * account, so it was a way for a patient to pay that nobody could collect. Removed from the
 * checkout, the gateway, the e-wallet bucket and — here — the database.
 *
 * The constraint is rebuilt from `constants/paymentMethods.js` rather than spelled out, so the
 * vocabulary has one definition. Restoring PayMaya later means adding the string there and
 * running this again (or `--rollback`, which restores the pre-[1.33.0] constraint verbatim).
 *
 * ── Why this refuses rather than converts ───────────────────────────────────────────────────
 *
 * A CHECK constraint cannot be narrowed while a row violates it. There are exactly two ways past
 * that, and one of them is forgery: rewriting a receipt to claim it was paid by a method the
 * patient did not use. Which method a real receipt should say is not a question this script can
 * answer, so it names the rows and stops — the same stance migrateClaimIntegrity.js takes when
 * two live claims exist for one test.
 *
 * ── Why NOT VALID is the wrong tool here ────────────────────────────────────────────────────
 *
 * NOT VALID would let the migration succeed over historical PayMaya rows, and it is exactly the
 * trap this project has already documented once: it skips the initial scan but Postgres still
 * enforces the constraint on every later UPDATE. The consequences are worse than a failed
 * migration:
 *
 *   - A 'Pending' gateway row for a PayMaya checkout started before this ran. PayMongo delivers
 *     `checkout_session.payment.paid`; markGatewayPaymentPaid UPDATEs the row; the CHECK
 *     re-evaluates against the new row version and raises 23514. Only 23505 is caught, so the
 *     webhook 500s, PayMongo redelivers, and it fails identically forever. The patient has been
 *     charged and no receipt exists. Worse, getNextReceiptNumber() runs BEFORE that UPDATE and
 *     the counter never rewinds, so every redelivery burns a receipt number — a widening gap in
 *     the official sequence, which is the precise thing daily_counters exists to prevent.
 *
 *   - A historical 'Paid' PayMaya receipt a cashier later needs to reverse. updatePaymentStatus
 *     is an UPDATE; same violation, and the refund is impossible.
 *
 * So: no violating row, or no migration.
 *
 * Additive in the sense that matters — it changes no data, only what future data may say.
 * Reversible:
 *   node src/scripts/migratePaymentMethods.js
 *   node src/scripts/migratePaymentMethods.js --rollback
 */
const db = require('../config/database');
const logger = require('../config/logger');
const { COUNTER_METHODS, sqlList } = require('../constants/paymentMethods');

// The vocabulary as it stood before [1.33.0]. Named rather than derived: a rollback must restore
// what was actually there, not whatever the constant happens to say today.
const PRE_1_33_0_METHODS = ['Cash', 'GCash', 'PayMaya', 'Bank'];

const CONSTRAINT = 'chk_payment_method';

/** Rows the target vocabulary would reject, newest first, with enough detail to act on. */
async function findViolations(client, allowed) {
  const { rows } = await client.query(
    `SELECT pay.id, pay.receipt_number, pay.payment_method, pay.payment_status,
            pay.amount, pay.paid_at::date AS on_date
       FROM payments pay
      WHERE pay.payment_method <> ALL($1)
      ORDER BY pay.paid_at DESC`,
    [allowed]
  );
  return rows;
}

async function applyConstraint(client, methods) {
  const violations = await findViolations(client, methods);
  if (violations.length > 0) {
    logger.error(
      `[1.33.0] Refusing: ${violations.length} payment(s) use a method this change would forbid. ` +
      'Narrowing the constraint over them would make the settlement webhook and any refund fail ' +
      'on those rows. Nothing has been changed.'
    );
    for (const v of violations.slice(0, 20)) {
      logger.error(
        `    ${v.receipt_number || `#${v.id}`}  ${v.payment_method}  ${v.amount}  ` +
        `${v.payment_status}  ${v.on_date ? v.on_date.toISOString().slice(0, 10) : 'no date'}`
      );
    }
    if (violations.length > 20) logger.error(`    … and ${violations.length - 20} more`);
    logger.error('  Decide how each should be recorded, correct them, then re-run.');
    const error = new Error(`${violations.length} payment(s) block this migration`);
    error.handled = true;
    throw error;
  }

  // DROP then ADD is the only way to change a CHECK in Postgres, and ADD CONSTRAINT has no
  // IF NOT EXISTS. Both run inside this migration's single transaction, so no other session ever
  // observes the table unconstrained.
  await client.query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
  await client.query(
    `ALTER TABLE payments ADD CONSTRAINT ${CONSTRAINT}
       CHECK (payment_method IN (${sqlList(methods)}))`
  );
  logger.info(`  + ${CONSTRAINT}: payment_method IN (${sqlList(methods)})`);
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  const target = reversing ? PRE_1_33_0_METHODS : COUNTER_METHODS;
  logger.info(reversing
    ? '[1.33.0] ROLLBACK — restoring the pre-[1.33.0] payment vocabulary…'
    : '[1.33.0] Narrowing the payment vocabulary to what the clinic can settle…');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await applyConstraint(client, target);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (!err.handled) logger.error(`[1.33.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();

  const { rows } = await db.query(
    `SELECT payment_method, COUNT(*)::int AS n
       FROM payments GROUP BY payment_method ORDER BY n DESC`
  );
  logger.info(`[1.33.0] Done. In use: ${rows.map((r) => `${r.payment_method} ${r.n}`).join(', ') || 'none'}.`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.33.0] Migration failed: ${err.message}`);
  process.exit(1);
});
