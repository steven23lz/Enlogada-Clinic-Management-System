/**
 * Migration [1.19.0] — account lockout after repeated failed logins, and PHI read auditing.
 *
 * ── Account lockout ──────────────────────────────────────────────────────────────────────
 *
 * [1.16.0] added a rate limiter on the credential endpoints, but it is keyed by IP, so an
 * attacker spreading attempts across addresses still gets unlimited guesses at any account. There
 * was no per-account counter anywhere in the schema.
 *
 * The obvious design is dangerous here, and worth saying out loud: a lockout that is too
 * aggressive is itself a denial of service *against the clinic*. Anyone who knows
 * receptionist@enlogada.com — and the address format is guessable — could deliberately fail five
 * logins at 08:00 and take the front desk offline during the morning rush. That is a worse
 * outcome than the attack it prevents.
 *
 * So the policy is deliberately forgiving:
 *   - the threshold is 10 consecutive failures, not 3 or 5;
 *   - the lock is 15 minutes and **expires on its own** — nobody has to be phoned to clear it;
 *   - a single successful login resets the counter, so ordinary mistyping never accumulates;
 *   - an administrator resetting the password clears it immediately.
 *
 * That is enough to make online guessing impractical (10 tries per 15 minutes per account) while
 * keeping the worst case a quarter of an hour rather than a call to IT.
 *
 * ── PHI read auditing ────────────────────────────────────────────────────────────────────
 *
 * All nine existing audit call sites are on writes. Nothing recorded who *read* a patient record,
 * so after the mass-read hole closed in the first pass ([1.11.x]) there would have been no way to
 * scope a breach notification — the only trace was a morgan line on stdout, which is not retained.
 * The Data Privacy Act expects an establishment to be able to say who accessed what.
 *
 * The volume risk is real and is the same shape as the notification fan-out that reached a
 * quarter-million rows: PHI reads are frequent. Two things keep it bounded — only reads of an
 * identified patient's records are logged (never list or worklist endpoints, which are the noisy
 * ones), and pruneAuditLog.js gives the table the retention it has never had.
 *
 * Additive and safe to re-run.
 *   node src/scripts/migrateLoginProtection.js
 */
const db = require('../config/database');
const logger = require('../config/logger');

const steps = [
  {
    name: 'users: consecutive failed-login counter and lock expiry',
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP
    `,
  },
  {
    name: 'audit_log: index for answering "who accessed this patient?"',
    // The question a breach notification has to answer is always scoped to a patient and a date
    // range, so that is what the index serves. Without it, the one query that matters during an
    // incident is a full scan of the busiest-growing table in the schema.
    sql: `
      CREATE INDEX IF NOT EXISTS idx_audit_log_entity_created
      ON audit_log (entity_type, entity_id, created_at DESC)
    `,
  },
  {
    name: 'audit_log: index for retention sweeps',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_audit_log_created
      ON audit_log (created_at)
    `,
  },
  {
    name: 'audit_log.actor_id: ON DELETE SET NULL, so the log can outlive the actor',
    // The table's own comment in schema.sql says actor_name is denormalized "since the log must
    // remain legible even if the actor's account is later deleted" — but the foreign key beside
    // it was NO ACTION, which made deleting such a user impossible. The stated intent and the
    // constraint contradicted each other, and the constraint won.
    //
    // This surfaced the moment PHI reads and lockouts started writing entries: the E2E purge,
    // which removes its throwaway accounts, began failing with
    //   update or delete on table "users" violates foreign key constraint "audit_log_actor_id_fkey"
    // and left test data behind — quietly undoing the guarantee that a run leaves the demo
    // dataset exactly as it found it.
    //
    // SET NULL is right rather than CASCADE: deleting a user must never erase the record of what
    // they did. actor_name keeps the entry readable.
    sql: `
      DO $$
      DECLARE fk_name TEXT;
      BEGIN
        SELECT con.conname INTO fk_name
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'audit_log' AND con.contype = 'f'
          AND pg_get_constraintdef(con.oid) LIKE '%actor_id%REFERENCES users%';

        IF fk_name IS NOT NULL AND pg_get_constraintdef(
             (SELECT oid FROM pg_constraint WHERE conname = fk_name)
           ) NOT LIKE '%ON DELETE SET NULL%' THEN
          EXECUTE format('ALTER TABLE audit_log DROP CONSTRAINT %I', fk_name);
          ALTER TABLE audit_log
            ADD CONSTRAINT audit_log_actor_id_fkey
            FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$
    `,
  },
];

async function main() {
  logger.info('[1.19.0] Adding account lockout and PHI read auditing…');

  for (const step of steps) {
    await db.query(step.sql);
    logger.info(`  + ${step.name}`);
  }

  // Any account already carrying a stale lock from a previous schema is cleared, so this
  // migration can never be the reason someone cannot sign in.
  const cleared = await db.query(
    `UPDATE users SET failed_login_count = 0, locked_until = NULL
     WHERE locked_until IS NOT NULL AND locked_until <= NOW()`
  );
  if (cleared.rowCount) logger.info(`  + cleared ${cleared.rowCount} expired lock(s)`);

  const locked = await db.query(
    `SELECT COUNT(*)::int AS c FROM users WHERE locked_until > NOW()`
  );
  logger.info(`[1.19.0] Done. ${locked.rows[0].c} account(s) currently locked.`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
