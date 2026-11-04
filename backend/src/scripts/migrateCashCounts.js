/**
 * [1.150.0] The end-of-day cash count.
 *
 * One table, `cash_counts`. A row is one count of the drawer for one business day: the change fund
 * it started with, what the till says was taken (a snapshot, so a later payment cannot change what
 * this count was measured against), the pieces counted, and the difference, which the database
 * works out. A recount adds a row and marks the old one superseded (one current per day, by the
 * partial unique index), so a shortage counted away still shows it was found.
 *
 *   node src/scripts/migrateCashCounts.js
 *   node src/scripts/migrateCashCounts.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

async function apply() {
  await db.withTransaction(async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS cash_counts (
        id SERIAL PRIMARY KEY,
        business_date DATE NOT NULL,
        change_fund NUMERIC(12,2) NOT NULL DEFAULT 0,
        expected_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
        expected_gcash NUMERIC(12,2) NOT NULL DEFAULT 0,
        expected_bank NUMERIC(12,2) NOT NULL DEFAULT 0,
        receipts INT NOT NULL DEFAULT 0,
        counted_cash NUMERIC(12,2) NOT NULL,
        difference NUMERIC(12,2) GENERATED ALWAYS AS (counted_cash - change_fund - expected_cash) STORED,
        pieces JSONB NOT NULL DEFAULT '{}',
        note TEXT,
        counted_by INT,
        counted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_current BOOLEAN NOT NULL DEFAULT TRUE,
        CONSTRAINT fk_cash_counts_counted_by FOREIGN KEY (counted_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT chk_cash_counts_amounts CHECK (change_fund >= 0 AND counted_cash >= 0)
      )
    `);
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_counts_current_per_day ON cash_counts (business_date) WHERE is_current');
    await db.query('CREATE INDEX IF NOT EXISTS idx_cash_counts_date ON cash_counts (business_date, counted_at)');
  });
  console.log('\n  cash_counts is in place.\n');
}

async function rollback() {
  await db.query('DROP TABLE IF EXISTS cash_counts');
  console.log('\n  Rolled back: cash_counts is gone, and with it every recorded count.\n');
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
