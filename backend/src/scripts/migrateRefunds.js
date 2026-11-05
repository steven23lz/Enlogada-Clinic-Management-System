/**
 * [1.155.0] A refund, with a record of its own.
 *
 * Two tables. `payment_refunds` is one giving-back of money: how much, why, how it went back, and who
 * did it. `payment_refund_tests` says which tests it was for, since a refund can be part of a receipt.
 * The cash book, the drawer count and the reports read money handed back from here and nowhere else.
 *
 * Reversals from before [1.121.0] are copied in as kind 'legacy', dated as they were, so every past day
 * still reconciles from one source. Their rows on `payments` are not touched.
 *
 *   node src/scripts/migrateRefunds.js
 *   node src/scripts/migrateRefunds.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

async function apply() {
  await db.withTransaction(async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS payment_refunds (
        id SERIAL PRIMARY KEY,
        payment_id INT NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        kind VARCHAR(30) NOT NULL,
        reason TEXT NOT NULL,
        returned_via VARCHAR(50) NOT NULL,
        returned_reference VARCHAR(100),
        refunded_by INT,
        refunded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
        CONSTRAINT fk_refunds_by FOREIGN KEY (refunded_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT chk_refunds_amount CHECK (amount > 0),
        CONSTRAINT chk_refunds_kind CHECK (kind IN ('clinic_cannot_perform', 'recorded_by_mistake', 'legacy')),
        CONSTRAINT chk_refunds_via CHECK (returned_via IN ('Cash', 'GCash', 'Bank'))
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS payment_refund_tests (
        refund_id INT NOT NULL,
        visit_test_id INT NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        PRIMARY KEY (refund_id, visit_test_id),
        CONSTRAINT fk_refund_tests_refund FOREIGN KEY (refund_id) REFERENCES payment_refunds(id) ON DELETE CASCADE,
        CONSTRAINT fk_refund_tests_test FOREIGN KEY (visit_test_id) REFERENCES visit_tests(id) ON DELETE CASCADE
      )
    `);
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_tests_one_per_test ON payment_refund_tests (visit_test_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_refunds_payment ON payment_refunds (payment_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_refunds_refunded_at ON payment_refunds (refunded_at)');

    const { rowCount } = await db.query(`
      INSERT INTO payment_refunds (payment_id, amount, kind, reason, returned_via, refunded_at)
      SELECT pay.id, pay.amount, 'legacy', COALESCE(NULLIF(TRIM(pay.refund_reason), ''), 'Reversed before refund records were kept.'),
             pay.payment_method, pay.refunded_at
        FROM payments pay
       WHERE pay.refunded_at IS NOT NULL
         AND pay.amount > 0
         AND NOT EXISTS (SELECT 1 FROM payment_refunds r WHERE r.payment_id = pay.id)
    `);
    console.log(`\n  ${rowCount} earlier reversal(s) copied in.`);
  });
  console.log('  payment_refunds is in place.\n');
}

async function rollback() {
  await db.query('DROP TABLE IF EXISTS payment_refund_tests');
  await db.query('DROP TABLE IF EXISTS payment_refunds');
  console.log('\n  Rolled back: the refund tables are gone, and with them every refund recorded since [1.155.0].\n');
}

(async () => {
  try {
    if (process.argv.includes('--rollback')) await rollback();
    else await apply();
  } catch (err) {
    console.error('\n  Failed:', err.message, '\n');
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
