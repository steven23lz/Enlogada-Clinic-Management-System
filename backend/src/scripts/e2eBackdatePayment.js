/**
 * Moves a payment's `paid_at` back by N days, so the suite can test a cross-day reversal.
 *
 * The regression [1.30.0] fixed is a receipt taken on one day and reversed on another: the
 * reversal used to be filed against the day the receipt was TAKEN, so it vanished from the day
 * it actually happened and silently restated a day that had already closed. Nothing in the API
 * can produce that state — a spec can only settle and reverse within one test body, which is the
 * same-day case that was never broken. Without a way to age a receipt, the fix has no test and
 * the bug can come back unnoticed.
 *
 * Lives in the backend and is shelled out to, exactly like purgeE2eData.js and for the same
 * reason: the database credentials and the `pg` client are here, and neither giving them to the
 * frontend nor exposing a mutate-anything endpoint on the API for tests to call is a trade worth
 * making.
 *
 * REFUSES TO RUN IN PRODUCTION. This rewrites the date on a financial record, which is the one
 * thing the whole [1.30.0] change exists to make trustworthy. Two independent guards, because a
 * single NODE_ENV check is one typo away from being no guard at all:
 *
 *   - NODE_ENV must not be 'production'
 *   - the payment's receipt must belong to an E2E-created patient, matched the same way
 *     purgeE2eData.js recognises test data
 *
 * A real clinic receipt therefore cannot be aged by this script even if it is run by accident on
 * a live database with NODE_ENV unset.
 *
 *   node src/scripts/e2eBackdatePayment.js --payment=123 --days=1
 */
require('dotenv').config();
const db = require('../config/database');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('backdate refused: NODE_ENV=production');
    process.exit(1);
  }

  const paymentId = Number(arg('payment'));
  const days = Number(arg('days') || 1);
  if (!Number.isInteger(paymentId) || paymentId <= 0) {
    console.error('backdate refused: --payment=<id> is required');
    process.exit(1);
  }
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    console.error('backdate refused: --days must be a whole number between 1 and 365');
    process.exit(1);
  }

  // The same recognition rule purgeE2eData.js uses — the throwaway account domain, which only a
  // registration made by the suite can carry. A receipt belonging to a real patient is not
  // eligible, whatever NODE_ENV says.
  const { rows } = await db.query(
    `SELECT pay.id
       FROM payments pay
       JOIN patient_visits pv ON pv.id = pay.patient_visit_id
       JOIN patients p        ON p.id = pv.patient_id
       JOIN users u           ON u.id = p.user_id
      WHERE pay.id = $1
        AND u.email LIKE '%@enlogada-e2e.test'`,
    [paymentId]
  );
  if (rows.length === 0) {
    console.error(`backdate refused: payment ${paymentId} is not an E2E-created receipt`);
    process.exit(1);
  }

  // Keeps the clock time and moves only the date, so the row stays inside business hours and a
  // reader of the table sees a plausible receipt rather than an obviously synthetic one.
  const { rows: updated } = await db.query(
    `UPDATE payments
        SET paid_at = paid_at - ($2 || ' days')::interval
      WHERE id = $1
      RETURNING id, paid_at`,
    [paymentId, days]
  );

  console.log(`backdated payment ${updated[0].id} to ${updated[0].paid_at.toISOString()}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`backdate failed: ${err.message}`);
  process.exit(1);
});
