/**
 * Removes the data an E2E run created, so the suite stops silting up the database.
 *
 * The suite builds a throwaway client, patient, visit and payment on nearly every spec and never
 * cleaned up after itself. Left running for a few days that reached thousands of visits, and —
 * because notification_reads fans out one row per recipient per event — a quarter of a million
 * notification rows. Slow tests and unusable demos were the visible symptoms; the real problem is
 * that nobody notices until the numbers are absurd.
 *
 * Two ways of recognising test data, because the suite creates two kinds:
 *
 *   1. Client accounts, which always use the @enlogada-e2e.test email domain. Everything hanging
 *      off those users goes with them.
 *   2. Walk-in patients, which reception creates with no user account at all and so carry no
 *      marker. These are matched by creation time instead — anything created since the run began.
 *      That window is why --since is required rather than defaulted: without it this would delete
 *      every walk-in in the database, including ones seeded for a demo.
 *
 * Invoked automatically by the Playwright global teardown. Also runnable by hand:
 *   node src/scripts/purgeE2eData.js --since=2026-08-14T09:00:00.000Z
 *   node src/scripts/purgeE2eData.js --since=... --dry-run
 */
const db = require('../config/database');
const logger = require('../config/logger');

const E2E_EMAIL_PATTERN = '%@enlogada-e2e.test';

function arg(name) {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? raw.split('=')[1] : null;
}

async function main() {
  const since = arg('since');
  const dryRun = process.argv.includes('--dry-run');

  if (process.env.NODE_ENV === 'production') {
    logger.error('Refusing to run against NODE_ENV=production.');
    process.exit(1);
  }
  if (!since || Number.isNaN(Date.parse(since))) {
    logger.error('--since=<ISO timestamp> is required (the moment the test run started).');
    process.exit(1);
  }

  // Visits in scope: anything owned by a throwaway account, plus anything at all created since
  // the run began.
  //
  // The run window has to cover more than walk-ins. Several specs book against the *seeded*
  // client account (client@enlogada.com) rather than registering their own, so scoping by owner
  // alone left their visits and appointments behind — the count crept up by three per run, which
  // is exactly the kind of slow leak that produced the original mess. Anything created after the
  // run started is the run's doing; a demo dataset seeded beforehand falls outside the window and
  // survives untouched.
  //
  // The trade-off: using the app by hand while the suite runs will lose that work. Acceptable on
  // a development database, and E2E_SKIP_PURGE=1 opts out.
  const visitScope = `
    SELECT pv.id FROM patient_visits pv
    JOIN patients p ON p.id = pv.patient_id
    LEFT JOIN users u ON u.id = p.user_id
    WHERE u.email LIKE $1
       OR pv.created_at >= $2::timestamptz
  `;
  const visitIds = (await db.query(visitScope, [E2E_EMAIL_PATTERN, since])).rows.map((r) => r.id);
  const userIds = (await db.query('SELECT id FROM users WHERE email LIKE $1', [E2E_EMAIL_PATTERN])).rows.map((r) => r.id);

  logger.info(`E2E purge: ${visitIds.length} visit(s), ${userIds.length} throwaway account(s)${dryRun ? ' (DRY RUN)' : ''}`);
  if (dryRun || (visitIds.length === 0 && userIds.length === 0)) {
    if (!dryRun) logger.info('Nothing to purge.');
    process.exit(0);
  }

  // Child-to-parent. Several foreign keys are not ON DELETE CASCADE, so order is load-bearing.
  //
  // hmo_requests does NOT carry a patient_visit_id — it reaches a visit only through
  // hmo_request_tests.visit_test_id. So the join rows go first, then any request left with no
  // tests attached to it.
  const v = [visitIds];
  await db.query(
    `DELETE FROM hmo_request_tests
     WHERE visit_test_id IN (SELECT id FROM visit_tests WHERE patient_visit_id = ANY($1))`, v
  );
  await db.query(
    `DELETE FROM hmo_requests hr
     WHERE NOT EXISTS (SELECT 1 FROM hmo_request_tests hrt WHERE hrt.hmo_request_id = hr.id)`
  );
  await db.query(`DELETE FROM test_results WHERE visit_test_id IN (SELECT id FROM visit_tests WHERE patient_visit_id = ANY($1))`, v);
  await db.query('DELETE FROM payments WHERE patient_visit_id = ANY($1)', v);
  await db.query('DELETE FROM visit_tests WHERE patient_visit_id = ANY($1)', v);
  await db.query('DELETE FROM appointments WHERE patient_visit_id = ANY($1)', v);
  await db.query('DELETE FROM patient_visits WHERE id = ANY($1)', v);

  if (userIds.length) {
    const u = [userIds];
    await db.query('DELETE FROM patients WHERE user_id = ANY($1)', u);
    await db.query('DELETE FROM notification_reads WHERE user_id = ANY($1)', u);
    await db.query('DELETE FROM password_reset_tokens WHERE user_id = ANY($1)', u);
    await db.query('DELETE FROM user_roles WHERE user_id = ANY($1)', u);
    await db.query('DELETE FROM users WHERE id = ANY($1)', u);
  }

  // Walk-in patients left parentless by the visit deletion above. Restricted to the run window so
  // a demo dataset seeded before the run survives.
  await db.query(
    `DELETE FROM patients p
     WHERE p.user_id IS NULL
       AND p.created_at >= $1::timestamptz
       AND NOT EXISTS (SELECT 1 FROM patient_visits pv WHERE pv.patient_id = p.id)`,
    [since]
  );

  // Notifications the run itself generated. These are addressed to the seeded STAFF accounts —
  // a test payment notifies the real cashier and superadmin — so deleting the throwaway client
  // accounts above leaves them behind entirely. That was the last remaining leak: ~200 rows per
  // run, invisible because no test ever looks at them, and this is the fan-out table that reached
  // a quarter of a million rows in the first place. notification_reads cascades from the event.
  await db.query('DELETE FROM notification_events WHERE created_at >= $1::timestamptz', [since]);
  await db.query('DELETE FROM notification_events ne WHERE NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.event_id = ne.id)');

  // Audit entries written by the run, for the same reason: the actor is a seeded staff account.
  await db.query('DELETE FROM audit_log WHERE created_at >= $1::timestamptz', [since]);

  logger.info('E2E purge complete.');
  process.exit(0);
}

main().catch((err) => {
  // Never fail the test run over cleanup — report and move on.
  logger.error(`E2E purge failed (non-fatal): ${err.message}`);
  process.exit(0);
});
