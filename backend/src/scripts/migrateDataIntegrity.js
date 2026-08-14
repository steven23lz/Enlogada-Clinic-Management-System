/**
 * Migration [1.13.0] — close the concurrency and duplication holes in queueing and billing.
 *
 * Four defects, one root cause: numbers that must be unique were generated with `SELECT COUNT(*)`
 * followed by a separate INSERT, and nothing in the schema enforced the uniqueness afterwards. A
 * read-then-write with no lock is not a sequence; it is a suggestion. All four only misbehave when
 * two things happen at once, which is why they survive testing and surface on a busy day.
 *
 *   1. QUEUE NUMBER (visitRepository.getNextQueueNumber)
 *      COUNT(*) of today's visits, +1. Two receptionists registering in the same moment both read
 *      5 and both issue ticket 0006. Two patients are called for the same number and the queue
 *      cannot say who is next. Counting rows also means cancelling a visit rewinds the sequence
 *      and reissues a number already handed out.
 *
 *   2. RECEIPT NUMBER (paymentRepository.getNextReceiptNumber)
 *      COUNT(*) of today's Paid payments, +1. Same race: two cashiers settling together both mint
 *      RCT-YYYYMMDD-0006. Two patients leave holding the same receipt number and the drawer cannot
 *      be reconciled against the system. It has a second trigger that needs no concurrency at all:
 *      refunding a payment drops it out of the Paid count, so the next sale that day reuses a
 *      receipt number that has already been printed and handed to someone.
 *
 *   3. DOUBLE PAYMENT (paymentService.processPayment)
 *      hasPaidPayment() then INSERT, with no constraint behind it. A double-clicked "Confirm
 *      Payment", or a retry after a network blip, charges the patient twice — and because the
 *      pre-check now returns true, nothing ever flags it. Both rows count toward the revenue
 *      reports.
 *
 *   4. RECEIPT NUMBERS WERE NEVER UNIQUE in the schema, so none of the above failed loudly.
 *
 * The counters live in one table rather than one table per counter: they have identical semantics
 * (a number that increases within a day and never repeats), so one atomic statement serves both.
 *
 *   INSERT INTO daily_counters (counter_date, counter_name, last_number)
 *   VALUES (CURRENT_DATE, 'queue', 1)
 *   ON CONFLICT (counter_date, counter_name)
 *   DO UPDATE SET last_number = daily_counters.last_number + 1
 *   RETURNING last_number;
 *
 * ON CONFLICT DO UPDATE takes a row lock, so concurrent callers serialise and get distinct numbers
 * from a single round trip. Existing days are seeded from the rows already recorded so numbering
 * continues where it left off rather than restarting at 1 and colliding with numbers already in
 * circulation.
 *
 * The unique indexes are the part that makes this durable: they move the invariant from "the code
 * that happens to call the counter today" into the database, so a future code path cannot quietly
 * reintroduce a duplicate.
 *
 * Additive and safe to re-run. Where existing data already violates a constraint, the index is
 * skipped and the offending rows are printed — a migration that refuses to finish is less useful
 * than one that applies what it can and tells you exactly what to clean up.
 *
 *   node src/scripts/migrateDataIntegrity.js
 */
const db = require('../config/database');
const logger = require('../config/logger');

const steps = [
  {
    name: 'daily_counters: gapless per-day sequences for queue tickets and receipts',
    sql: `
      CREATE TABLE IF NOT EXISTS daily_counters (
        counter_date DATE NOT NULL,
        counter_name TEXT NOT NULL,
        last_number  INT  NOT NULL DEFAULT 0,
        PRIMARY KEY (counter_date, counter_name),
        CONSTRAINT chk_daily_counters_nonneg CHECK (last_number >= 0)
      )
    `,
  },
  {
    name: "seed 'queue' from existing visits so ticket numbering continues",
    // GREATEST(row count, highest number actually issued) covers both a clean history and one
    // where visits were deleted. The regexp strips zero padding defensively: queue_number is a
    // VARCHAR and nothing has ever constrained it to digits, so a stray value must not abort this.
    sql: `
      INSERT INTO daily_counters (counter_date, counter_name, last_number)
      SELECT created_at::date, 'queue',
             GREATEST(
               COUNT(*)::int,
               COALESCE(MAX((NULLIF(regexp_replace(queue_number, '[^0-9]', '', 'g'), ''))::int), 0)
             )
      FROM patient_visits
      WHERE created_at IS NOT NULL
      GROUP BY created_at::date
      ON CONFLICT (counter_date, counter_name) DO NOTHING
    `,
  },
  {
    name: "seed 'receipt' from every payment that has ever held a receipt number",
    // Deliberately NOT filtered to payment_status = 'Paid'. That filter is what let a refund
    // rewind the sequence: a refunded payment's receipt number is still printed and still in the
    // patient's hands, so it must continue to occupy its slot forever.
    sql: `
      INSERT INTO daily_counters (counter_date, counter_name, last_number)
      SELECT paid_at::date, 'receipt',
             GREATEST(
               COUNT(*)::int,
               COALESCE(MAX((NULLIF(regexp_replace(split_part(receipt_number, '-', 3), '[^0-9]', '', 'g'), ''))::int), 0)
             )
      FROM payments
      WHERE receipt_number IS NOT NULL AND paid_at IS NOT NULL
      GROUP BY paid_at::date
      ON CONFLICT (counter_date, counter_name) DO NOTHING
    `,
  },
];

/**
 * Creates a unique index only if the data already satisfies it, printing the offending rows
 * otherwise. `probe` must return one row per violation.
 */
async function guardedUniqueIndex({ label, probe, describe, sql }) {
  const { rows } = await db.query(probe);
  if (rows.length > 0) {
    logger.warn(`  ! ${label} — skipped, ${rows.length} existing violation(s):`);
    for (const r of rows.slice(0, 10)) logger.warn(`      ${describe(r)}`);
    if (rows.length > 10) logger.warn(`      …and ${rows.length - 10} more`);
    logger.warn('    Resolve these, then re-run to install the constraint.');
    return false;
  }
  await db.query(sql);
  logger.info(`  + ${label}`);
  return true;
}

async function main() {
  logger.info('[1.13.0] Closing queue/billing concurrency and duplication holes…');

  for (const step of steps) {
    await db.query(step.sql);
    logger.info(`  + ${step.name}`);
  }

  await guardedUniqueIndex({
    label: 'unique (visit date, queue_number) — no two patients share a ticket',
    probe: `SELECT created_at::date AS day, queue_number, COUNT(*)::int AS n
            FROM patient_visits WHERE queue_number IS NOT NULL
            GROUP BY 1,2 HAVING COUNT(*) > 1 ORDER BY 1 DESC, 2`,
    describe: (r) => `${r.day.toISOString().slice(0, 10)} ticket #${r.queue_number} issued ${r.n}×`,
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_visits_daily_queue
          ON patient_visits ((created_at::date), queue_number) WHERE queue_number IS NOT NULL`,
  });

  await guardedUniqueIndex({
    label: 'unique receipt_number — a receipt number identifies exactly one payment',
    probe: `SELECT receipt_number, COUNT(*)::int AS n
            FROM payments WHERE receipt_number IS NOT NULL
            GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY 1`,
    describe: (r) => `receipt ${r.receipt_number} used by ${r.n} payments`,
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_receipt_number
          ON payments (receipt_number) WHERE receipt_number IS NOT NULL`,
  });

  await guardedUniqueIndex({
    label: 'unique paid payment per visit — a visit cannot be charged twice',
    // Partial on 'Paid' by design: a visit may accumulate Cancelled/Failed gateway attempts and a
    // Refunded row alongside its one live payment. Only one settled charge may exist at a time.
    probe: `SELECT patient_visit_id, COUNT(*)::int AS n
            FROM payments WHERE payment_status = 'Paid'
            GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY 1`,
    describe: (r) => `visit #${r.patient_visit_id} has ${r.n} paid payments`,
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_paid_per_visit
          ON payments (patient_visit_id) WHERE payment_status = 'Paid'`,
  });

  const seeded = await db.query(
    `SELECT counter_name, COUNT(*)::int AS days FROM daily_counters GROUP BY 1 ORDER BY 1`
  );
  logger.info(`[1.13.0] Done. Counters seeded: ${seeded.rows.map((r) => `${r.counter_name}=${r.days} day(s)`).join(', ') || 'none'}`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
