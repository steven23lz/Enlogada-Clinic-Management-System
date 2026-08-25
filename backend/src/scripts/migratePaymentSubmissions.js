/**
 * Additive migration [1.48.0] — the clinic's own payment channels, and manual proof of payment.
 *
 * The clinic wants online payment WITHOUT a gateway. A patient pays into the clinic's GCash or
 * bank account themselves, uploads a screenshot of the transaction with its reference number, and
 * a cashier eyeballs it and approves. Only then is the booking's QR pass issued.
 *
 * That is deliberately not PayMongo. The gateway path ([1.37.0]) stays in the codebase, dormant
 * and unconfigured; this is a parallel, human-verified channel that needs no merchant account and
 * no publicly reachable webhook.
 *
 * ── Two tables, not one ─────────────────────────────────────────────────────────────────────
 *
 * `payment_methods` is what the clinic PUBLISHES — a GCash number and its QR image, a bank
 * account. SuperAdmin-managed, because it is where a patient's money is about to be sent: a wrong
 * or malicious account number here routes real payments to a stranger, which is the highest-value
 * write in the whole application.
 *
 * `payment_submissions` is what a patient CLAIMS — "I sent ₱1,450, here is the screenshot and the
 * reference". It is evidence, not money. It exists before any payment does, it can be rejected,
 * and a rejected one has to keep saying what it said.
 *
 * ── Why `payments` is not simply extended ───────────────────────────────────────────────────
 *
 * `payments` is the money. Every peso figure in the app — the cashier's drawer, the operations
 * report, the daily cash book — is aggregated from it, and `receipt_number` is issued from
 * `daily_counters` at the moment a real payment is taken. An unverified claim is none of those
 * things. Writing claims into `payments` with some 'Unverified' status would put them one missing
 * WHERE clause away from being counted as revenue, which is exactly the class of bug [1.30.0]
 * spent a release fixing.
 *
 * So a submission is separate, and on approval the cashier's EXISTING payment path runs — the same
 * one a counter payment uses, with the same receipt number and the same audit trail. The
 * submission then records which payment it produced.
 *
 * Additive and idempotent. Reversible:
 *   node src/scripts/migratePaymentSubmissions.js
 *   node src/scripts/migratePaymentSubmissions.js --rollback
 */
const db = require('../config/database');
const logger = require('../config/logger');

async function migrate(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id SERIAL PRIMARY KEY,
      -- Which cash-up bucket this settles into, NOT free text.
      --
      -- payments.payment_method is constrained to exactly these three by chk_payment_method
      -- ([1.33.0]), and the cashier's drawer tiles and findTransactionSummary are built on them.
      -- A method whose kind did not map to one of the three would produce a verified payment the
      -- constraint rejects — or, worse, a fourth bucket that belongs to no tile and quietly goes
      -- missing from the day's totals.
      --
      -- The clinic's own naming lives in the label column instead: kind Bank, label BPI Savings.
      -- (No backticks in here: this is inside a JS template literal.)
      kind VARCHAR(50) NOT NULL,
      -- What the patient reads: "GCash — Enlogada Clinic", "BPI Savings".
      label VARCHAR(120) NOT NULL,
      account_name VARCHAR(150),
      account_number VARCHAR(100),
      -- Only meaningful for a bank; NULL for an e-wallet.
      bank_name VARCHAR(120),
      -- Anything the patient has to be told: "use your full name as the message".
      instructions TEXT,
      -- The scannable QR image the clinic publishes. Same four-column shape as HMO card evidence,
      -- so the same validated upload path and the same authenticated read-back apply.
      qr_file_path VARCHAR(255),
      qr_original_name TEXT,
      qr_mime_type VARCHAR(100),
      qr_size_bytes INT,
      is_active BOOLEAN DEFAULT TRUE,
      -- The clinic decides what to show first; a patient reads the list top-down.
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_payment_methods_kind CHECK (kind IN ('Cash', 'GCash', 'Bank'))
    )
  `);
  logger.info('  + payment_methods');

  await client.query(`
    CREATE TABLE IF NOT EXISTS payment_submissions (
      id SERIAL PRIMARY KEY,
      patient_visit_id INT NOT NULL,
      -- Which channel the patient says they used. Kept even if that method is later retired, so a
      -- historical submission still says how the money arrived.
      payment_method_id INT,
      -- What the clinic will check the screenshot against. Not unique: a patient may legitimately
      -- resubmit after a rejection, and two different patients' providers can reuse a reference.
      reference_number VARCHAR(100) NOT NULL,
      amount_claimed NUMERIC(10,2) NOT NULL,
      -- The screenshot. Same shape and same rules as the HMO card.
      proof_file_path VARCHAR(255),
      proof_original_name TEXT,
      proof_mime_type VARCHAR(100),
      proof_size_bytes INT,
      status VARCHAR(20) NOT NULL DEFAULT 'Pending',
      submitted_by INT,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_by INT,
      reviewed_at TIMESTAMP,
      -- Why it was turned down. Required by the service on a rejection for the same reason
      -- [1.27.0] requires one on an HMO refusal: the patient asks, and somebody has to answer.
      review_note TEXT,
      -- The real payment this produced, once a cashier approved it. NULL until then.
      payment_id INT,
      CONSTRAINT fk_paysub_visit FOREIGN KEY (patient_visit_id) REFERENCES patient_visits(id),
      CONSTRAINT fk_paysub_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id),
      CONSTRAINT fk_paysub_submitted_by FOREIGN KEY (submitted_by) REFERENCES users(id),
      CONSTRAINT fk_paysub_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id),
      CONSTRAINT fk_paysub_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
      CONSTRAINT chk_paysub_status CHECK (status IN ('Pending', 'Verified', 'Rejected')),
      CONSTRAINT chk_paysub_amount CHECK (amount_claimed >= 0)
    )
  `);
  logger.info('  + payment_submissions');

  // One LIVE claim per visit. A patient may resubmit after a rejection — that is the point of a
  // rejection — but two Pending claims on one visit means two cashiers can approve the same money
  // twice, and the visit is then paid twice with two receipts. Partial, so rejected history is
  // unlimited. Same shape as uq_hmo_one_live_claim_per_test from [1.31.0], for the same reason.
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_paysub_one_live_per_visit
        ON payment_submissions (patient_visit_id)
     WHERE status = 'Pending'
  `);
  logger.info('  + uq_paysub_one_live_per_visit (partial)');

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_paysub_visit ON payment_submissions (patient_visit_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_paysub_method ON payment_submissions (payment_method_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_paysub_submitted_by ON payment_submissions (submitted_by)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_paysub_reviewed_by ON payment_submissions (reviewed_by)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_paysub_payment ON payment_submissions (payment_id)
  `);
  // The cashier's queue: everything awaiting review, oldest first. Partial, because a settled
  // submission is never in it and there will be far more of those than pending ones.
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_paysub_pending ON payment_submissions (submitted_at)
     WHERE status = 'Pending'
  `);
  logger.info('  + indexes');
}

async function rollback(client) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM payment_submissions`
  ).catch(() => ({ rows: [{ n: 0 }] }));
  if (rows[0].n > 0) {
    logger.warn(`  ! ${rows[0].n} payment submission(s) will be deleted, including their review history`);
    logger.warn('    (the payments they produced are in `payments` and are NOT touched)');
  }

  for (const idx of ['uq_paysub_one_live_per_visit', 'idx_paysub_visit', 'idx_paysub_method',
    'idx_paysub_submitted_by', 'idx_paysub_reviewed_by', 'idx_paysub_payment', 'idx_paysub_pending']) {
    await client.query(`DROP INDEX IF EXISTS ${idx}`);
  }
  await client.query('DROP TABLE IF EXISTS payment_submissions');
  logger.info('  - payment_submissions');
  await client.query('DROP TABLE IF EXISTS payment_methods');
  logger.info('  - payment_methods');
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(`[1.48.0] ${reversing ? 'Rolling back' : 'Applying'} payment methods + submissions…`);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.48.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();

  if (!reversing) {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM payment_methods')
      .catch(() => ({ rows: [{ n: 0 }] }));
    logger.info(`[1.48.0] Done. ${rows[0].n} payment method(s) configured — add them under Super Admin.`);
  } else {
    logger.info('[1.48.0] Done.');
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.48.0] Migration failed: ${err.message}`);
  process.exit(1);
});
