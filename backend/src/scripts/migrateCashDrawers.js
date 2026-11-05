/**
 * [1.162.0] Ready for more than one drawer.
 *
 * Steven: one drawer for now, "but future ready" for when the clinic has two cashiers. The clinic chooses on
 * Super Admin, with no developer needed:
 *   clinic_settings          one row per setting the clinic changes itself ('cash_drawers')
 *   cash_counts.drawer_of    NULL: the clinic's one shared drawer. A user: that cashier's own.
 * Every count already made stays NULL, and nothing changes until the setting does.
 *
 *   node src/scripts/migrateCashDrawers.js
 *   node src/scripts/migrateCashDrawers.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

async function apply() {
  await db.withTransaction(async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS clinic_settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_by INT,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_clinic_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      )`);
    await db.query('ALTER TABLE cash_counts ADD COLUMN IF NOT EXISTS drawer_of INT');
    await db.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cash_counts_drawer_of') THEN
          ALTER TABLE cash_counts ADD CONSTRAINT fk_cash_counts_drawer_of FOREIGN KEY (drawer_of) REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$;`);
    await db.query('DROP INDEX IF EXISTS uq_cash_counts_current_per_day');
    await db.query('CREATE UNIQUE INDEX uq_cash_counts_current_per_day ON cash_counts (business_date, COALESCE(drawer_of, 0)) WHERE is_current');
  });
  console.log('\n  Cash drawers are ready: one shared drawer until the clinic says otherwise.\n');
}

async function rollback() {
  await db.withTransaction(async () => {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM cash_counts WHERE drawer_of IS NOT NULL');
    if (rows[0].n > 0) throw new Error(`${rows[0].n} count(s) belong to one cashier's drawer. One drawer a day cannot hold them; nothing was changed.`);
    await db.query('DROP INDEX IF EXISTS uq_cash_counts_current_per_day');
    await db.query('ALTER TABLE cash_counts DROP CONSTRAINT IF EXISTS fk_cash_counts_drawer_of');
    await db.query('ALTER TABLE cash_counts DROP COLUMN IF EXISTS drawer_of');
    await db.query('CREATE UNIQUE INDEX uq_cash_counts_current_per_day ON cash_counts (business_date) WHERE is_current');
    await db.query('DROP TABLE IF EXISTS clinic_settings');
  });
  console.log('\n  Rolled back: one drawer, and no clinic_settings.\n');
}

(async () => {
  try {
    await (process.argv.includes('--rollback') ? rollback() : apply());
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
})();
