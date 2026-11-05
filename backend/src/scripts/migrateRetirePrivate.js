/**
 * [1.161.0] 'Private' is retired as a patient type.
 *
 * Steven: Self Pay and Private make no difference, because the clinic accepts a patient without a doctor's
 * note. They always billed the same; Private's one effect was demanding the note. Its patients become
 * Self Pay and the row goes. Their ids are written to audit_log first, so --rollback can put them back.
 *
 *   node src/scripts/migrateRetirePrivate.js
 *   node src/scripts/migrateRetirePrivate.js --rollback
 */

require('dotenv').config();
const db = require('../config/database');

const ACTION = 'patient_type.private_retired';

async function apply() {
  await db.withTransaction(async () => {
    const { rows: types } = await db.query(`SELECT id, name FROM patient_types WHERE name IN ('Private', 'Self Pay')`);
    const priv = types.find((t) => t.name === 'Private');
    const self = types.find((t) => t.name === 'Self Pay');
    if (!priv) { console.log('\n  Private is already retired.\n'); return; }
    if (!self) throw new Error('No Self Pay patient type to move them to.');
    const { rows } = await db.query('SELECT id FROM patients WHERE patient_type_id = $1 ORDER BY id', [priv.id]);
    await db.query(
      `INSERT INTO audit_log (actor_name, action, entity_type, description)
       VALUES ('Migration', $1, 'patient_type', $2)`,
      [ACTION, JSON.stringify({ patientIds: rows.map((r) => r.id) })]
    );
    await db.query('UPDATE patients SET patient_type_id = $1 WHERE patient_type_id = $2', [self.id, priv.id]);
    await db.query('DELETE FROM patient_types WHERE id = $1', [priv.id]);
    console.log(`\n  Private is retired; ${rows.length} patient record(s) are Self Pay now.\n`);
  });
}

async function rollback() {
  await db.withTransaction(async () => {
    await db.query(`INSERT INTO patient_types (name) VALUES ('Private') ON CONFLICT (name) DO NOTHING`);
    const { rows } = await db.query('SELECT description FROM audit_log WHERE action = $1 ORDER BY id DESC LIMIT 1', [ACTION]);
    const ids = rows[0] ? JSON.parse(rows[0].description).patientIds : [];
    await db.query(
      `UPDATE patients SET patient_type_id = (SELECT id FROM patient_types WHERE name = 'Private') WHERE id = ANY($1::int[])`,
      [ids]
    );
    console.log(`\n  Rolled back: Private is back, with ${ids.length} patient record(s).\n`);
  });
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
