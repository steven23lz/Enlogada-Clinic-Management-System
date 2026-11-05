/**
 * [1.160.0] A claim refused as a whole frees its tests for a new claim.
 *
 * Refusing a claim set hmo_requests.status alone, so each of its tests still read 'Pending' or 'Approved'
 * on hmo_request_tests. uq_hmo_one_live_claim_per_test keys on that column, so it took the test for a live
 * claim: "That test already has an HMO claim open", for good, on a claim nobody could raise again. Refusing
 * now closes the lines too. This does the same for claims refused or withdrawn before it.
 *
 * Data only, and safe to re-run. Nothing to roll back: every reader takes a refusal at either level as a
 * refusal already (hmoEffectiveStatus), so what the bills and reports say does not change.
 *
 *   node src/scripts/migrateRefusedClaimLines.js
 */

require('dotenv').config();
const db = require('../config/database');

(async () => {
  try {
    const { rowCount } = await db.query(`
      UPDATE hmo_request_tests hrt
         SET approval_status = 'Rejected',
             decision_reason = COALESCE(hrt.decision_reason, hr.decision_reason),
             decided_by = COALESCE(hrt.decided_by, hr.decided_by),
             decided_at = COALESCE(hrt.decided_at, hr.approved_date, CURRENT_TIMESTAMP)
        FROM hmo_requests hr
       WHERE hr.id = hrt.hmo_request_id
         AND hr.status IN ('Rejected', 'Cancelled')
         AND hrt.approval_status <> 'Rejected'`);
    console.log(`\n  Closed ${rowCount} test line(s) on refused or withdrawn claims.\n`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
