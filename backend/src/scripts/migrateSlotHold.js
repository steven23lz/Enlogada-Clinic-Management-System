/**
 * Additive migration [1.35.0] — a booking that is waiting on an online payment holds its slot,
 * rather than taking it forever.
 *
 * ── What was broken ─────────────────────────────────────────────────────────────────────────
 *
 * `POST /appointments` writes the appointment before payment is ever discussed, and slot capacity
 * is `status <> 'Cancelled'` and nothing else — no capacity query joins `payments`. So a slot was
 * taken the instant a booking existed, paid or not, and exactly one thing could ever give it
 * back: a human cancelling it.
 *
 * A patient who opened GCash and closed the tab therefore held 11:30 forever. Nothing released
 * it. There is no cron and no scheduler in this project; none of the three retention passes
 * touches `appointments`; `cancelPendingGatewayPayments` updates the `payments` table alone; and
 * the webhook understands only `checkout_session.payment.paid`, so a failed or expired session
 * is answered with `{ handled: false }` and 200. The e2e cleanup script's own header already
 * records the consequence: every bookable day filled within three days of runs.
 *
 * ── The column ──────────────────────────────────────────────────────────────────────────────
 *
 *   held_until TIMESTAMP   NULL means the booking is permanent. Non-NULL means it is provisional
 *                          and its claim on the slot lapses at that moment.
 *
 * NULL-means-permanent is the important direction. Every appointment that exists today is a real
 * booking, so a nullable column with no backfill leaves all of them exactly as they are — the
 * migration cannot change what any existing slot means. The alternative encoding, a `held`
 * boolean plus a timestamp, has a fourth state that means nothing and would need a rule.
 *
 * ── Expiry is evaluated at READ time, deliberately ──────────────────────────────────────────
 *
 * There is no reaper job, and adding one would be worse. A sweeper runs on an interval, so
 * between the hold lapsing and the sweep the slot is still wrongly blocked — the bug in miniature,
 * just shorter. Putting `held_until > CURRENT_TIMESTAMP` in the capacity predicate means the slot
 * reopens at the exact instant the hold ends, with nothing needing to run and nothing to schedule,
 * monitor or fail. The row is left behind as an audit trail of an abandoned attempt rather than
 * deleted.
 *
 * The cost is that every capacity query carries one more term. That is what the partial index is
 * for, and it is a term over a handful of rows a day.
 *
 * Additive, idempotent, one transaction. Reversible:
 *   node src/scripts/migrateSlotHold.js
 *   node src/scripts/migrateSlotHold.js --rollback
 */
const db = require('../config/database');
const logger = require('../config/logger');

async function columnExists(table, column) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function migrate(client) {
  if (await columnExists('appointments', 'held_until')) {
    logger.info('  = appointments.held_until already present');
  } else {
    await client.query('ALTER TABLE appointments ADD COLUMN held_until TIMESTAMP');
    logger.info('  + appointments: add held_until (NULL = a permanent booking)');
  }

  // Nothing is back-filled. Every appointment that exists predates the idea of a provisional
  // booking and is therefore a real one; giving them a hold would expire live bookings.

  // Partial, because the overwhelming majority of appointments are permanent and carry NULL. The
  // capacity predicate reads this alongside idx_appointments_scheduled.
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_appointments_held_until
       ON appointments (held_until) WHERE held_until IS NOT NULL`
  );
  logger.info('  + idx_appointments_held_until (partial: provisional bookings only)');
}

async function rollback(client) {
  const { rows } = await db
    .query('SELECT COUNT(*)::int AS n FROM appointments WHERE held_until > CURRENT_TIMESTAMP')
    .catch(() => ({ rows: [{ n: 0 }] }));
  if (rows[0].n > 0) {
    logger.warn(
      `  ! ${rows[0].n} booking(s) are currently held pending payment. Dropping the column makes ` +
      'them permanent, so those slots stay taken whether or not anybody pays for them.'
    );
  }
  await client.query('DROP INDEX IF EXISTS idx_appointments_held_until');
  await client.query('ALTER TABLE appointments DROP COLUMN IF EXISTS held_until');
  logger.info('  - drop appointments.held_until');
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(reversing
    ? '[1.35.0] ROLLBACK — removing the provisional hold…'
    : '[1.35.0] Letting an unpaid booking hold a slot rather than take it…');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.35.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();

  if (reversing) {
    logger.info('[1.35.0] Rolled back.');
    process.exit(0);
  }

  const { rows } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE held_until IS NULL)::int                    AS permanent,
            COUNT(*) FILTER (WHERE held_until > CURRENT_TIMESTAMP)::int        AS holding,
            COUNT(*) FILTER (WHERE held_until <= CURRENT_TIMESTAMP)::int       AS lapsed
       FROM appointments WHERE status <> 'Cancelled'`
  );
  const r = rows[0];
  logger.info(
    `[1.35.0] Done. ${r.permanent} permanent booking(s), ${r.holding} holding, ${r.lapsed} lapsed ` +
    '(a lapsed hold no longer occupies its slot).'
  );
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.35.0] Migration failed: ${err.message}`);
  process.exit(1);
});
