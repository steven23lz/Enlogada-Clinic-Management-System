/**
 * Ages an E2E patient record, then runs the 10-year archive pass, so a spec can test what no API can
 * reach. [1.162.0] Refuses production, and refuses any patient who is not a test fixture (the reserved
 * number 09000000000 in tests/e2e/helpers/people.js).
 *
 *   node src/scripts/e2eAgeRecord.js --patient=123 --years=11
 *   node src/scripts/e2eAgeRecord.js --sweep          prints what the pass archived, as JSON
 */
require('dotenv').config();
const db = require('../config/database');
const retentionService = require('../services/retentionService');

const FIXTURE_CONTACT = '09000000000';
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

(async () => {
  if (process.env.NODE_ENV === 'production') {
    console.error('age-record refused: NODE_ENV=production');
    process.exit(1);
  }
  if (process.argv.includes('--sweep')) {
    console.log(JSON.stringify(await retentionService.archiveDormantRecords()));
    process.exit(0);
  }
  const patientId = Number(arg('patient'));
  const years = Number(arg('years') || 11);
  const { rows } = await db.query('SELECT contact_number FROM patients WHERE id = $1', [patientId]);
  if (rows[0]?.contact_number !== FIXTURE_CONTACT) {
    console.error('age-record refused: not a test fixture');
    process.exit(1);
  }
  await db.query(
    `UPDATE patients SET created_at = created_at - make_interval(years => $2), updated_at = updated_at - make_interval(years => $2) WHERE id = $1`,
    [patientId, years]
  );
  process.exit(0);
})().catch((err) => {
  console.error(`age-record failed: ${err.message}`);
  process.exit(1);
});
