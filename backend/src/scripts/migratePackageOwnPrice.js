/**
 * [1.159.0] A package at its tests' own prices, and a note on a package off sale.
 *
 *   visit_tests.package_share     what the package price gave this line when it was booked
 *   visit_tests.list_price        this test's own price when it was booked
 *   test_packages.retired_test_ids  the tests that came out of a package off sale, so its note can
 *                                 name them until it is offered again
 *
 * price_at_time stays the one figure everything reads. An HMO covering only part of a package moves it
 * from the share to the list price, and back if the rest is approved later, so both are kept.
 *
 * The backfill reads a booked line's list price from today's catalogue: nothing older exists. Paid visits
 * keep what they were charged. An unpaid visit whose package is already partly covered is repriced here.
 *
 *   node src/scripts/migratePackageOwnPrice.js
 *   node src/scripts/migratePackageOwnPrice.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

async function apply() {
  await db.withTransaction(async () => {
    await db.query('ALTER TABLE visit_tests ADD COLUMN IF NOT EXISTS package_share NUMERIC(10,2)');
    await db.query('ALTER TABLE visit_tests ADD COLUMN IF NOT EXISTS list_price NUMERIC(10,2)');
    await db.query(`ALTER TABLE test_packages ADD COLUMN IF NOT EXISTS retired_test_ids INT[] NOT NULL DEFAULT '{}'`);
    const filled = await db.query(`
      UPDATE visit_tests vt
         SET package_share = vt.price_at_time, list_price = t.price
        FROM tests t
       WHERE t.id = vt.test_id AND vt.package_id IS NOT NULL AND vt.package_share IS NULL`);
    console.log(`  Filled ${filled.rowCount} package line(s).`);
  });

  // Not in the transaction above: this reads the columns it just made, through the service's own rule.
  const packageService = require('../services/packageService');
  const { rows } = await db.query(`
    SELECT DISTINCT vt.patient_visit_id AS id
      FROM visit_tests vt
      JOIN hmo_request_tests hrt ON hrt.visit_test_id = vt.id
     WHERE vt.package_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.patient_visit_id = vt.patient_visit_id AND p.payment_status = 'Paid')`);
  let repriced = 0;
  for (const { id } of rows) {
    const { changed } = await db.withTransaction(() => packageService.repriceForHmo(id));
    if (changed.length) repriced += 1;
  }
  console.log(`  Repriced ${repriced} unpaid visit(s) whose package was already partly covered.`);
  console.log('\n  Package prices and off-sale notes are in place.\n');
}

async function rollback() {
  await db.withTransaction(async () => {
    // Back to the package price on every bill still open: without these columns nothing can say why.
    await db.query(`
      UPDATE visit_tests vt
         SET price_at_time = vt.package_share
       WHERE vt.package_share IS NOT NULL AND vt.price_at_time <> vt.package_share
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.patient_visit_id = vt.patient_visit_id AND p.payment_status = 'Paid')`);
    await db.query('ALTER TABLE visit_tests DROP COLUMN IF EXISTS package_share, DROP COLUMN IF EXISTS list_price');
    await db.query('ALTER TABLE test_packages DROP COLUMN IF EXISTS retired_test_ids');
  });
  console.log('\n  Rolled back: package lines are at their shares, and the three columns are gone.\n');
}

(async () => {
  try {
    await (process.argv.includes('--rollback') ? rollback() : apply());
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
