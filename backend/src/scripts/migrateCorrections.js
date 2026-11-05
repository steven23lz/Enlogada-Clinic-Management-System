/**
 * [1.156.0] Taking a mistake back, and recording a patient's agreement.
 *
 *   test_results.withdrawn_at / _by / _reason     a released report pulled back from the patient
 *   appointments.checked_in_from_date             the date a booking had before a check-in moved it,
 *                                                 so a check-in made by mistake can put it back
 *   users.terms_accepted_at                       when the account agreed to the Terms and Privacy Policy
 *
 * Three nullable columns. Existing accounts stay NULL: they signed up before it was asked. And a
 * withdrawn report keeps its verification code, so the public check can say it was withdrawn.
 *
 *   node src/scripts/migrateCorrections.js
 *   node src/scripts/migrateCorrections.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

async function apply() {
  await db.withTransaction(async () => {
    await db.query('ALTER TABLE test_results ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMP');
    await db.query('ALTER TABLE test_results ADD COLUMN IF NOT EXISTS withdrawn_by INT');
    await db.query('ALTER TABLE test_results ADD COLUMN IF NOT EXISTS withdrawn_reason TEXT');
    await db.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_test_results_withdrawn_by') THEN
          ALTER TABLE test_results ADD CONSTRAINT fk_test_results_withdrawn_by FOREIGN KEY (withdrawn_by) REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await db.query('ALTER TABLE test_results DROP CONSTRAINT IF EXISTS chk_results_verification_code');
    await db.query(`ALTER TABLE test_results ADD CONSTRAINT chk_results_verification_code CHECK (
      verification_code IS NULL
      OR ((authorised_at IS NOT NULL OR withdrawn_at IS NOT NULL) AND verification_code ~ '^[0-9A-HJKMNP-TV-Z]{10}$')
    )`);
    await db.query('ALTER TABLE appointments ADD COLUMN IF NOT EXISTS checked_in_from_date DATE');
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP');
  });
  console.log('\n  Corrections columns are in place.\n');
}

async function rollback() {
  await db.withTransaction(async () => {
    // A withdrawn report has no authorised_at, so its code cannot survive the narrower rule.
    await db.query('UPDATE test_results SET verification_code = NULL WHERE authorised_at IS NULL AND verification_code IS NOT NULL');
    await db.query('ALTER TABLE test_results DROP CONSTRAINT IF EXISTS chk_results_verification_code');
    await db.query(`ALTER TABLE test_results ADD CONSTRAINT chk_results_verification_code CHECK (
      verification_code IS NULL
      OR (authorised_at IS NOT NULL AND verification_code ~ '^[0-9A-HJKMNP-TV-Z]{10}$')
    )`);
    await db.query('ALTER TABLE test_results DROP CONSTRAINT IF EXISTS fk_test_results_withdrawn_by');
    await db.query('ALTER TABLE test_results DROP COLUMN IF EXISTS withdrawn_at, DROP COLUMN IF EXISTS withdrawn_by, DROP COLUMN IF EXISTS withdrawn_reason');
    await db.query('ALTER TABLE appointments DROP COLUMN IF EXISTS checked_in_from_date');
    await db.query('ALTER TABLE users DROP COLUMN IF EXISTS terms_accepted_at');
  });
  console.log('\n  Rolled back: the corrections columns are gone.\n');
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
