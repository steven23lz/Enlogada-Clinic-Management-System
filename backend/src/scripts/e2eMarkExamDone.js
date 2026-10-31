/**
 * Marks an E2E X-ray exam done the way [1.129.0] did, so a spec can check how such an exam still
 * reads. [1.143.0] X-ray reports here again, and no API marks an exam done any more, but the exams
 * marked done from [1.129.0] until then stay on History, Patient Records and the portal as Done.
 *
 * REFUSES TO RUN IN PRODUCTION, and refuses any test whose patient is not a test fixture (the
 * reserved number 09000000000 every fixture is registered with, tests/e2e/helpers/people.js).
 *
 *   node src/scripts/e2eMarkExamDone.js --visit-test=123
 *   node src/scripts/e2eMarkExamDone.js --visit-test=123 --by=xray@enlogada.com
 */
require('dotenv').config();
const db = require('../config/database');
const testRepository = require('../repositories/testRepository');
const visitRepository = require('../repositories/visitRepository');

const FIXTURE_CONTACT = '09000000000';
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('mark-exam-done refused: NODE_ENV=production');
    process.exit(1);
  }
  const visitTestId = Number(arg('visit-test'));
  if (!Number.isInteger(visitTestId) || visitTestId <= 0) {
    console.error('mark-exam-done refused: --visit-test=<id> is required');
    process.exit(1);
  }
  const { rows: [line] } = await db.query(
    `SELECT vt.id, vt.patient_visit_id AS visit_id
       FROM visit_tests vt
       JOIN patient_visits pv ON pv.id = vt.patient_visit_id
       JOIN patients p ON p.id = pv.patient_id
      WHERE vt.id = $1 AND p.contact_number = $2`,
    [visitTestId, FIXTURE_CONTACT]
  );
  if (!line) {
    console.error(`mark-exam-done refused: visit test ${visitTestId} is not a test fixture's`);
    process.exit(1);
  }
  const { rows: [by] } = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [arg('by') || 'xray@enlogada.com']);
  if (!by) {
    console.error('mark-exam-done refused: no account with that --by address');
    process.exit(1);
  }

  // As resultService.updateTestStatus did: the test, then the visit once nothing else is out.
  const done = await db.withTransaction(async () => {
    const row = await testRepository.markPerformed(visitTestId, by.id);
    if (!row) return null;
    if (!(await visitRepository.hasOutstandingTests(line.visit_id))) {
      await visitRepository.updateVisitStatus(line.visit_id, 'Completed');
    }
    return row;
  });
  if (!done) {
    console.error(`mark-exam-done refused: visit test ${visitTestId} is not with its department (unpaid, or already done)`);
    process.exit(1);
  }
  console.log(`marked visit test ${done.id} done at ${done.performed_at.toISOString()}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`mark-exam-done failed: ${err.message}`);
  process.exit(1);
});
