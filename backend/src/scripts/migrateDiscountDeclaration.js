/**
 * [1.146.0] A Senior Citizen or PWD discount declared when booking online.
 *
 * An online booking must be paid within its time to pay, and once paid its discount cannot change
 * (a receipt is final), so a senior or a PWD who booked online could never receive the 20% the law
 * gives them. Steven: they declare it when booking, with the ID number and a photo of the ID; the
 * bill is discounted at once, and whoever takes the payment checks the ID before the discount is
 * granted in their name (`discount_granted_by` stays NULL until then).
 *
 * Two columns on `patient_visits`:
 *
 *   discount_id_file_path / discount_id_mime_type
 *
 * The photo lives in uploads/discount-ids, an identity document kept with the visit's record.
 *
 *   node src/scripts/migrateDiscountDeclaration.js
 *   node src/scripts/migrateDiscountDeclaration.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

const COLUMNS = [
  ['discount_id_file_path', 'VARCHAR(255)'],
  ['discount_id_mime_type', 'VARCHAR(100)'],
];

async function apply() {
  await db.withTransaction(async () => {
    for (const [name, type] of COLUMNS) {
      await db.query(`ALTER TABLE patient_visits ADD COLUMN IF NOT EXISTS ${name} ${type}`);
    }
  });
  console.log('\n  patient_visits.discount_id_* columns are in place.\n');
}

async function rollback() {
  await db.withTransaction(async () => {
    for (const [name] of COLUMNS) {
      await db.query(`ALTER TABLE patient_visits DROP COLUMN IF EXISTS ${name}`);
    }
  });
  console.log('\n  Rolled back. Uploaded ID photos stay in uploads/discount-ids until removed by hand.\n');
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
