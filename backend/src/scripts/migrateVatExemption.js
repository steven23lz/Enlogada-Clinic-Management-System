/**
 * Migration [1.17.0] — VAT-exempt treatment for statutory (Senior Citizen / PWD) discounts.
 *
 * [1.14.0] shipped the statutory discount as a flat 20% and said so explicitly: correct for a
 * non-VAT establishment, and an understatement for a VAT-registered one, pending confirmation of
 * the clinic's BIR registration. Enlogada is VAT-registered, so this completes it.
 *
 * RA 9994 and RA 10754 make the sale to a senior citizen or PWD VAT-EXEMPT. For a VAT-registered
 * establishment the order of operations is fixed by statute and is not the intuitive one:
 *
 *     VAT-inclusive price          1,000.00
 *     less 12% VAT                  -107.14     (1000 - 1000/1.12)
 *     ----------------------------------------
 *     VAT-exempt sale                892.86
 *     less 20% discount             -178.57     (20% of the VAT-EXEMPT base, not of the price)
 *     ----------------------------------------
 *     Amount due                     714.29
 *
 * A flat 20% off the price gives 800.00 instead — so the patient was being **overcharged by
 * 85.71 per 1,000**, and the clinic was understating the deduction it can claim. Discounting
 * before removing VAT would also mean charging a VAT-exempt patient VAT on part of the sale.
 *
 * Only STATUTORY discounts get this treatment. A promo or corporate rate is an ordinary discount
 * on a VAT-inclusive price and carries no exemption, which is why discount_types.is_statutory
 * drives the branch rather than the percentage.
 *
 * `payments.vat_amount` stores the VAT removed, so a receipt can show the breakdown BIR requires
 * and the statutory register can report VAT-exempt sales. With it, the whole sale reconciles:
 *
 *     amount + discount_amount + vat_amount = the original VAT-inclusive price
 *
 * Existing rows are backfilled to 0, which is accurate: every payment recorded before this either
 * carried no statutory discount or was computed the flat way, and rewriting historical receipts
 * to claim a VAT treatment they were not issued under would be worse than leaving them alone.
 * Those receipts are already in patients' hands.
 *
 * Additive and safe to re-run.
 *   node src/scripts/migrateVatExemption.js
 */
const db = require('../config/database');
const env = require('../config/environment');
const logger = require('../config/logger');

async function main() {
  logger.info('[1.17.0] Adding VAT-exempt treatment for statutory discounts…');

  await db.query(`
    ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(10,2) NOT NULL DEFAULT 0
  `);
  logger.info('  + payments.vat_amount (VAT removed from a VAT-exempt statutory sale)');

  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payments_vat_nonneg') THEN
        ALTER TABLE payments ADD CONSTRAINT chk_payments_vat_nonneg CHECK (vat_amount >= 0);
      END IF;
    END $$
  `);
  logger.info('  + vat_amount can never be negative');

  const rows = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE discount_type_name IS NOT NULL)::int AS discounted
     FROM payments`
  );
  const { total, discounted } = rows.rows[0];

  logger.info(
    `[1.17.0] Done. ${total} payment(s), ${discounted} with a discount; historical rows left at ` +
      'vat_amount = 0 (their receipts were issued the flat way and are already with patients).'
  );
  logger.info(
    `        Clinic is configured as ${env.CLINIC_VAT_REGISTERED ? 'VAT-REGISTERED' : 'NON-VAT'} ` +
      `at ${(env.VAT_RATE * 100).toFixed(0)}% — set CLINIC_VAT_REGISTERED in backend/.env to change.`
  );
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
