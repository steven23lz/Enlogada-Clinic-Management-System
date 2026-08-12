/**
 * Additive migration [1.6.0] — Ticket Release Gating + Online Payment Gateway.
 *
 * Applied directly against the live dev database rather than via `migrateDb.js`, which is
 * destructive (it drops and recreates every table from schema.sql and would discard the
 * accumulated seed/test data from Modules 1-18). Same approach used by [1.4.0] and [1.5.0].
 *
 * `schema.sql` remains the canonical source of truth for fresh installs — it already carries
 * every change below. This script only brings an EXISTING database up to that shape.
 *
 * Safe to re-run: every statement is guarded or idempotent.
 *
 *   node src/scripts/migrateTicketFlow.js
 */
const db = require('../config/database');
const logger = require('../config/logger');

const steps = [
  {
    name: "visit_tests: allow 'Waiting for Release' status",
    // DROP ... IF EXISTS then re-ADD is the only way to widen a CHECK constraint in Postgres.
    // Both statements run inside the migration's single transaction, so the table is never
    // left unconstrained from any other session's point of view.
    sql: `
      ALTER TABLE visit_tests DROP CONSTRAINT IF EXISTS chk_visit_tests_status;
      ALTER TABLE visit_tests ADD CONSTRAINT chk_visit_tests_status
        CHECK (status IN ('Pending', 'Approved', 'Processing', 'Waiting for Release', 'Completed', 'Cancelled'));
    `
  },
  {
    name: 'payments: add online gateway linkage columns',
    sql: `
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_provider VARCHAR(30);
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_session_id VARCHAR(120);
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_payment_id VARCHAR(120);
    `
  },
  {
    name: 'payments: unique gateway session + lookup index',
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_payments_gateway_session'
        ) THEN
          ALTER TABLE payments ADD CONSTRAINT uq_payments_gateway_session UNIQUE (gateway_session_id);
        END IF;
      END $$;
      CREATE INDEX IF NOT EXISTS idx_payments_gateway_session ON payments(gateway_session_id);
    `
  }
];

const run = async () => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const step of steps) {
      logger.info(`[1.6.0] ${step.name}`);
      await client.query(step.sql);
    }
    await client.query('COMMIT');
    logger.info('[1.6.0] Ticket-flow migration completed successfully.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[1.6.0] Ticket-flow migration failed — rolled back, database unchanged:', err);
    process.exit(1);
  } finally {
    client.release();
  }
};

run();
