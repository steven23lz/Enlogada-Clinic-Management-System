/**
 * Moves an E2E visit back by some minutes, or runs the overdue check, so a spec need not wait an hour.
 * [1.163.0] Refuses production, and any patient who is not a test fixture.
 *
 *   node src/scripts/e2eOverdue.js --visit=123 --minutes=70
 *   node src/scripts/e2eOverdue.js --sweep       prints how many patients were told
 *   node src/scripts/e2eOverdue.js --sweep --closing   the same, as if it were 15 minutes before closing
 */
require('dotenv').config();
const db = require('../config/database');
const overdueResultService = require('../services/overdueResultService');

const FIXTURE_CONTACT = '09000000000';
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

(async () => {
  if (process.env.NODE_ENV === 'production') {
    console.error('overdue refused: NODE_ENV=production');
    process.exit(1);
  }
  if (process.argv.includes('--sweep')) {
    const closing = process.argv.includes('--closing') ? { inWindow: true, closesAt: '17:00' } : undefined;
    console.log(JSON.stringify(await overdueResultService.sweep({ closing })));
    process.exit(0);
  }
  const visitId = Number(arg('visit'));
  const minutes = Number(arg('minutes'));
  const { rows } = await db.query(
    `SELECT p.contact_number FROM patient_visits pv JOIN patients p ON p.id = pv.patient_id WHERE pv.id = $1`,
    [visitId]
  );
  if (rows[0]?.contact_number !== FIXTURE_CONTACT) {
    console.error('overdue refused: not a test fixture');
    process.exit(1);
  }
  await db.query(`UPDATE patient_visits SET created_at = created_at - make_interval(mins => $2) WHERE id = $1`, [visitId, minutes]);
  await db.query(`UPDATE payments SET paid_at = paid_at - make_interval(mins => $2) WHERE patient_visit_id = $1`, [visitId, minutes]);
  process.exit(0);
})().catch((err) => {
  console.error(`overdue failed: ${err.message}`);
  process.exit(1);
});
