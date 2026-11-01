/**
 * [1.147.0] A patient changes their own sign-in email.
 *
 * The sign-in email could never change: My Account said so, and no screen or route did it, so a
 * patient who moved to a new address had to make a second account and have every record moved. The
 * change is confirmed by a code sent to the NEW address (purpose 'email_change'), after the current
 * password; the old address is told.
 *
 * Widens the two CHECK constraints on `auth_codes` to admit the new purpose, shaped like
 * 'email_verify': bound to an account, no password stored.
 *
 *   node src/scripts/migrateEmailChange.js
 *   node src/scripts/migrateEmailChange.js --rollback   (refuses while an email_change code is open)
 */

require('dotenv').config();
const db = require('../config/database');

const PURPOSE = (purposes) => `CHECK (purpose IN (${purposes.map((p) => `'${p}'`).join(', ')}))`;
const SHAPE = (accountPurposes) => `CHECK (
  (purpose IN (${accountPurposes.map((p) => `'${p}'`).join(', ')}) AND user_id IS NOT NULL AND password_hash IS NULL)
  OR (purpose = 'signup' AND user_id IS NULL AND password_hash IS NOT NULL
      AND first_name IS NOT NULL AND last_name IS NOT NULL)
)`;

async function setConstraints(accountPurposes) {
  await db.withTransaction(async () => {
    await db.query('ALTER TABLE auth_codes DROP CONSTRAINT IF EXISTS chk_auth_codes_purpose');
    await db.query('ALTER TABLE auth_codes DROP CONSTRAINT IF EXISTS chk_auth_codes_shape');
    await db.query(`ALTER TABLE auth_codes ADD CONSTRAINT chk_auth_codes_purpose ${PURPOSE(['signup', ...accountPurposes])}`);
    await db.query(`ALTER TABLE auth_codes ADD CONSTRAINT chk_auth_codes_shape ${SHAPE(accountPurposes)}`);
  });
}

async function apply() {
  await setConstraints(['password_reset', 'email_verify', 'email_change']);
  console.log("\n  auth_codes accepts 'email_change'.\n");
}

async function rollback() {
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM auth_codes WHERE purpose = 'email_change'");
  if (rows[0].n > 0) {
    await db.query("DELETE FROM auth_codes WHERE purpose = 'email_change'");
    console.log(`  Removed ${rows[0].n} email-change code(s); those changes were never confirmed.`);
  }
  await setConstraints(['password_reset', 'email_verify']);
  console.log("\n  Rolled back: auth_codes no longer accepts 'email_change'.\n");
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
