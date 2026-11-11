/**
 * test_results no longer points at itself. [1.166.0]
 *
 * `superseded_by` was the forward link of the amendment chain: an old version carried the id of the
 * version that replaced it. Nothing read it. The order of a test's versions is `version`, the live
 * one is `is_current`, and the public check finds a replacement by the next authorised version.
 * Steven asked for the table's connection to itself to go, as long as nothing depended on it.
 *
 * Drops the index, the foreign key and the column. Nothing is archived, because the value can be
 * rebuilt exactly: a version's replacement is the same test's next version. `--rollback` adds the
 * three back and fills the column that way.
 *
 *   node src/scripts/migrateRemoveSupersededBy.js
 *   node src/scripts/migrateRemoveSupersededBy.js --rollback
 */
require('dotenv').config();
const { pool } = require('../config/database');
const logger = require('../config/logger');

(async () => {
  const reversing = process.argv.includes('--rollback');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) {
      await client.query('ALTER TABLE test_results ADD COLUMN IF NOT EXISTS superseded_by INT');
      const { rows } = await client.query(
        `SELECT 1 FROM pg_constraint
          WHERE conrelid = 'test_results'::regclass AND conname = 'fk_results_superseded_by'`
      );
      if (rows.length === 0) {
        await client.query(`ALTER TABLE test_results ADD CONSTRAINT fk_results_superseded_by
                              FOREIGN KEY (superseded_by) REFERENCES test_results(id)`);
      }
      const filled = await client.query(
        `UPDATE test_results older
            SET superseded_by = newer.id
           FROM test_results newer
          WHERE newer.visit_test_id = older.visit_test_id
            AND newer.version = older.version + 1
            AND older.superseded_by IS DISTINCT FROM newer.id`
      );
      await client.query('CREATE INDEX IF NOT EXISTS idx_test_results_superseded_by ON test_results(superseded_by)');
      await client.query('COMMIT');
      logger.info(`[1.166.0] + test_results.superseded_by (${filled.rowCount} rebuilt from version order)`);
      return;
    }

    await client.query('DROP INDEX IF EXISTS idx_test_results_superseded_by');
    await client.query('ALTER TABLE test_results DROP CONSTRAINT IF EXISTS fk_results_superseded_by');
    await client.query('ALTER TABLE test_results DROP COLUMN IF EXISTS superseded_by');
    await client.query('COMMIT');
    logger.info('[1.166.0] - test_results.superseded_by');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error(`[1.166.0] Failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
