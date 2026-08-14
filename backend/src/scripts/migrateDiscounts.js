/**
 * Migration [1.14.0] — statutory discounts (Senior Citizen / PWD) and a general discount model.
 *
 * The clinic could not lawfully bill a senior citizen or a person with disability, because the
 * system had no concept of a discount at all. RA 9994 (Expanded Senior Citizens Act) and RA 10754
 * (PWD) both mandate 20% off medical and diagnostic services, itemised on the receipt, with the
 * holder's ID recorded and a separate sales register kept for BIR. The only occurrence of the word
 * "discount" anywhere in the app was a mislabel on the HMO coverage line.
 *
 * The practical consequence of leaving this out is not that seniors pay full price — it is that
 * cashiers work around it. They edit the catalogue price, or they take the difference off in cash
 * and out of the system. Either one destroys the receipt trail that every other control in this
 * codebase depends on, so the gap does more damage than a missing feature normally would.
 *
 * Modelled generally rather than as two hardcoded cases, because the same shape covers the
 * commercial discounts a clinic also needs (corporate rate, employee, promo) at no extra cost.
 * `is_statutory` marks the two that exist by law: those cannot be deactivated from the catalogue
 * screen, and they require an ID number to be recorded against the visit.
 *
 * Where the numbers live:
 *   - patient_visits carries the ENTITLEMENT (which discount, whose ID, who granted it, when).
 *     It belongs to the visit because the bill is computed per visit and the cashier needs to see
 *     the discounted total before taking any money.
 *   - payments carries a SNAPSHOT of what was actually deducted. A receipt is a historical record
 *     and must not change if the discount catalogue is later edited — the same reasoning behind
 *     visit_tests.price_at_time.
 *
 * On VAT: this system has no VAT decomposition, and this migration deliberately does not invent
 * one. For a VAT-registered establishment the statute requires the 12% VAT to be stripped first
 * and the 20% applied to the VAT-exempt base; for a non-VAT establishment it is a flat 20%. Which
 * applies is a question about the clinic's BIR registration, not about this code, so the discount
 * is computed as a straight percentage and the answer is left visible rather than guessed at. See
 * the note in paymentService.getBillingSummary.
 *
 * Additive and safe to re-run.
 *   node src/scripts/migrateDiscounts.js
 */
const db = require('../config/database');
const logger = require('../config/logger');

const steps = [
  {
    name: 'discount_types: the discount catalogue',
    sql: `
      CREATE TABLE IF NOT EXISTS discount_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        percentage NUMERIC(5,2) NOT NULL,
        -- Mandated by law: cannot be deactivated, and requires the holder's ID on the visit.
        is_statutory BOOLEAN NOT NULL DEFAULT FALSE,
        requires_id  BOOLEAN NOT NULL DEFAULT FALSE,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_discount_percentage CHECK (percentage >= 0 AND percentage <= 100)
      )
    `,
  },
  {
    name: 'seed the two statutory discounts (RA 9994, RA 10754)',
    sql: `
      INSERT INTO discount_types (name, percentage, is_statutory, requires_id)
      VALUES ('Senior Citizen', 20.00, TRUE, TRUE),
             ('PWD',            20.00, TRUE, TRUE)
      ON CONFLICT (name) DO NOTHING
    `,
  },
  {
    name: 'patient_visits: the entitlement claimed for this visit',
    sql: `
      ALTER TABLE patient_visits
        ADD COLUMN IF NOT EXISTS discount_type_id   INT REFERENCES discount_types(id),
        ADD COLUMN IF NOT EXISTS discount_id_number VARCHAR(50),
        ADD COLUMN IF NOT EXISTS discount_granted_by INT REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS discount_granted_at TIMESTAMP
    `,
  },
  {
    name: 'payments: an immutable snapshot of what was actually deducted',
    // Mirrors visit_tests.price_at_time: a receipt must keep saying what it said, even if the
    // discount catalogue is edited afterwards.
    sql: `
      ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS discount_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS discount_type_name VARCHAR(50),
        ADD COLUMN IF NOT EXISTS discount_id_number VARCHAR(50)
    `,
  },
  {
    name: 'payments: discount can never be negative',
    // Guarded separately because ADD CONSTRAINT has no IF NOT EXISTS in PostgreSQL.
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_payments_discount_nonneg'
        ) THEN
          ALTER TABLE payments
            ADD CONSTRAINT chk_payments_discount_nonneg CHECK (discount_amount >= 0);
        END IF;
      END $$
    `,
  },
  {
    name: 'index the statutory discount register (BIR reporting)',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_payments_discount_type
      ON payments (discount_type_name, paid_at) WHERE discount_type_name IS NOT NULL
    `,
  },
];

async function main() {
  logger.info('[1.14.0] Adding statutory (Senior/PWD) and general discounts…');

  for (const step of steps) {
    await db.query(step.sql);
    logger.info(`  + ${step.name}`);
  }

  const seeded = await db.query(
    'SELECT name, percentage, is_statutory FROM discount_types ORDER BY is_statutory DESC, name'
  );
  logger.info('[1.14.0] Done. Discount catalogue:');
  for (const d of seeded.rows) {
    logger.info(`      ${d.name} — ${d.percentage}%${d.is_statutory ? ' (statutory)' : ''}`);
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
