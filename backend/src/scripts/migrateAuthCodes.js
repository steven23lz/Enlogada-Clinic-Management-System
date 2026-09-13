/**
 * [1.73.0] Emailed 6-digit codes for sign-up and password reset, and one account per address.
 *
 * ── What this adds ──────────────────────────────────────────────────────────────────────────
 *
 * `auth_codes` holds both kinds of code. A pending SIGN-UP lives here, not in `users`: the account
 * is created only when the code from the email is entered, so there is never a half-created,
 * unproven account for anybody to take over. A password RESET points at its account.
 *
 * ── What this removes ───────────────────────────────────────────────────────────────────────
 *
 * `password_reset_tokens`, the emailed reset LINK. A code replaces it. The table only ever held
 * short-lived tokens, so dropping it loses nothing a person needs; `--rollback` recreates it empty.
 *
 * ── One account per address, whatever the capitals ──────────────────────────────────────────
 *
 * users.email was UNIQUE exactly as typed, so `John@x.com` and `john@x.com` could be two accounts.
 * A UNIQUE index on LOWER(email) closes that, and serves the case-insensitive lookup sign-in now
 * does. It is created only if no two existing accounts already differ by case alone — if some do,
 * they are listed and the index is left for a person to decide, rather than guessing which of two
 * real accounts is the right one.
 *
 * Additive and safe to re-run.
 *
 *   node src/scripts/migrateAuthCodes.js
 *   node src/scripts/migrateAuthCodes.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

async function apply() {
  await db.withTransaction(async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS auth_codes (
        id SERIAL PRIMARY KEY,
        purpose VARCHAR(20) NOT NULL,
        email VARCHAR(150) NOT NULL,
        user_id INT,
        ticket_hash VARCHAR(64) NOT NULL UNIQUE,
        code_hash VARCHAR(64) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        contact_number VARCHAR(20),
        password_hash TEXT,
        attempts SMALLINT NOT NULL DEFAULT 0,
        sends SMALLINT NOT NULL DEFAULT 1,
        last_sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        consumed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_auth_codes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT chk_auth_codes_purpose CHECK (purpose IN ('signup', 'password_reset')),
        CONSTRAINT chk_auth_codes_shape CHECK (
          (purpose = 'password_reset' AND user_id IS NOT NULL AND password_hash IS NULL)
          OR (purpose = 'signup' AND user_id IS NULL AND password_hash IS NOT NULL
              AND first_name IS NOT NULL AND last_name IS NOT NULL)
        )
      )
    `);
    await db.query(
      'CREATE INDEX IF NOT EXISTS idx_auth_codes_purpose_email ON auth_codes (purpose, email, created_at)'
    );
    await db.query(
      'CREATE INDEX IF NOT EXISTS idx_auth_codes_user ON auth_codes (user_id) WHERE user_id IS NOT NULL'
    );
    await db.query('DROP TABLE IF EXISTS password_reset_tokens');
  });

  const { rows: clashes } = await db.query(`
    SELECT LOWER(email) AS email, COUNT(*)::int AS accounts
      FROM users
     GROUP BY LOWER(email)
    HAVING COUNT(*) > 1
  `);

  if (clashes.length > 0) {
    console.warn('\n  These addresses belong to more than one account, differing only by capitals:');
    for (const c of clashes) console.warn(`    ${c.email} (${c.accounts} accounts)`);
    console.warn('  uq_users_email_lower was NOT created. Merge or rename them, then re-run this script.\n');
  } else {
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (LOWER(email))');
  }

  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM auth_codes');
  console.log(`\n  auth_codes ready (${rows[0].n} row(s)); password_reset_tokens removed.`);
  console.log(`  One account per address: ${clashes.length ? 'NOT enforced yet, see above' : 'enforced'}.\n`);
}

async function rollback() {
  await db.withTransaction(async () => {
    await db.query('DROP INDEX IF EXISTS uq_users_email_lower');
    await db.query('DROP TABLE IF EXISTS auth_codes');
    await db.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await db.query(
      'CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id)'
    );
  });
  console.log('\n  Rolled back: auth_codes and uq_users_email_lower dropped; password_reset_tokens recreated, empty.');
  console.log('  The code that uses it must be rolled back too (git revert the [1.73.0] commit).\n');
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
