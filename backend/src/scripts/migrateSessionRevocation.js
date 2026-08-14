/**
 * Migration [1.16.0] — make a password change actually end existing sessions.
 *
 * "Reset the password" is the standard response to a stolen session, and in this system it did
 * nothing at all to the attacker.
 *
 * The token lives in localStorage, so an XSS bug, a shared reception workstation, or a token
 * captured from a log is enough to lift one. The victim notices, changes their password, and
 * believes the problem is solved — but `updatePasswordHash` wrote only `password_hash` and
 * `updated_at`, `verifyToken` checked only signature, account existence and `status`, and there is
 * no `/logout` route to invalidate anything server-side. The stolen token therefore kept full
 * access to patient records until it expired naturally, which the deployed `.env` set to seven
 * days.
 *
 * `password_changed_at` closes that. verifyToken already loads the user row on every request (see
 * [1.11.0]), so rejecting a token issued before the last password change costs nothing extra: no
 * new query, no denylist to maintain, no shared state between instances.
 *
 * On the one-second tolerance in the check: a JWT's `iat` is in whole seconds while this column is
 * a millisecond timestamp, so a token minted in the same second as the change can look older than
 * it is by up to 999ms. Without slack, changing your own password would reject the very token
 * issued to replace it. One second is far below any realistic attack window.
 *
 * Backfilled to each account's `updated_at` rather than to now: setting it to now would be a lie
 * about when the password last changed, and backfilling to NULL would leave the check inert.
 * Tokens issued before this migration are honoured, which is correct — nobody's password changed.
 *
 * Additive and safe to re-run.
 *   node src/scripts/migrateSessionRevocation.js
 */
const db = require('../config/database');
const logger = require('../config/logger');

async function main() {
  logger.info('[1.16.0] Making a password change end existing sessions…');

  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP
  `);
  logger.info('  + users.password_changed_at');

  // updated_at is the closest honest approximation available for existing rows, and for most
  // accounts it IS the last time the password was set (account creation).
  const backfilled = await db.query(`
    UPDATE users SET password_changed_at = COALESCE(updated_at, created_at)
    WHERE password_changed_at IS NULL
  `);
  logger.info(`  + backfilled ${backfilled.rowCount} account(s) from updated_at`);

  const counts = await db.query(
    `SELECT COUNT(*)::int AS total, COUNT(password_changed_at)::int AS stamped FROM users`
  );
  const { total, stamped } = counts.rows[0];
  logger.info(`[1.16.0] Done. ${stamped}/${total} account(s) carry a password-change timestamp.`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
