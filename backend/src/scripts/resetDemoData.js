/**
 * Clears accumulated test/fixture traffic and leaves a small, realistic dataset behind.
 *
 * Why this exists: the E2E suite creates a throwaway client, patient, visit and payment on every
 * run and never cleans up, so a long-lived dev database drifts far away from anything a clinic
 * would recognise — at the time this was written it held 2,276 users, 3,034 visits and a billing
 * queue 965 deep. That is bad for three separate reasons. Demos look chaotic. Screens that
 * paginate or aggregate stop resembling their real behaviour. And tests that walk a list to find
 * their own record get slower every run until they time out, which is a failure that looks like a
 * bug in the feature rather than in the data.
 *
 * What it never touches: reference data (roles, permissions, patient types, test categories and
 * the test catalogue, HMO providers, operating hours) and the seeded staff/demo accounts. Only
 * transactional traffic and the accounts the suite invented are removed.
 *
 * Safe by default — reports what it WOULD delete and changes nothing:
 *   node src/scripts/resetDemoData.js
 *
 * Actually perform the reset:
 *   node src/scripts/resetDemoData.js --confirm
 */
const db = require('../config/database');
const logger = require('../config/logger');

// Accounts that must survive: the per-role seeds from seedUsers.js plus the combined-role demo
// account documented in TEST_ACCOUNTS.md.
const PROTECTED_EMAILS = [
  'admin@enlogada.com',
  'clinicadmin@enlogada.com',
  'receptionist@enlogada.com',
  'cashier@enlogada.com',
  'lab@enlogada.com',
  'ultrasound@enlogada.com',
  'xray@enlogada.com',
  'client@enlogada.com',
  'multirole@enlogada.com',
];

// Child-to-parent order. Foreign keys are not all declared ON DELETE CASCADE, so this sequence
// matters: deleting a parent first fails the constraint and aborts the whole transaction.
const TRANSACTIONAL_TABLES = [
  'notification_reads',
  'notification_events',
  'audit_log',
  'hmo_request_tests',
  'hmo_requests',
  'test_results',
  'payments',
  'visit_tests',
  'appointments',
  'patient_visits',
  'password_reset_tokens',
];

async function tableCount(table, where = '') {
  try {
    const res = await db.query(`SELECT COUNT(*)::int AS c FROM ${table} ${where}`);
    return res.rows[0].c;
  } catch {
    return null; // table absent on an older schema — reported, not fatal
  }
}

async function main() {
  const confirmed = process.argv.includes('--confirm');

  if (process.env.NODE_ENV === 'production') {
    logger.error('Refusing to run against NODE_ENV=production. This script deletes patient data.');
    process.exit(1);
  }

  const placeholders = PROTECTED_EMAILS.map((_, i) => `$${i + 1}`).join(', ');
  const disposableUsers = `SELECT id FROM users WHERE email NOT IN (${placeholders})`;

  logger.info(confirmed ? 'Resetting demo data…' : 'DRY RUN — nothing will be deleted. Re-run with --confirm to apply.');

  for (const table of TRANSACTIONAL_TABLES) {
    const count = await tableCount(table);
    if (count === null) {
      logger.warn(`  ${table.padEnd(24)} (absent on this schema — skipped)`);
      continue;
    }
    logger.info(`  ${table.padEnd(24)} ${count} row(s)`);
    if (confirmed && count > 0) await db.query(`DELETE FROM ${table}`);
  }

  const countOf = async (sql, params = []) => (await db.query(sql, params)).rows[0].c;
  const linkedPatients = await countOf(
    `SELECT COUNT(*)::int AS c FROM patients WHERE user_id IN (${disposableUsers})`,
    PROTECTED_EMAILS
  );
  const walkInPatients = await countOf(
    'SELECT COUNT(*)::int AS c FROM patients WHERE user_id IS NULL'
  );
  const disposableUsersCount = await countOf(
    `SELECT COUNT(*)::int AS c FROM users WHERE email NOT IN (${placeholders})`,
    PROTECTED_EMAILS
  );

  logger.info(`  patients (client-owned)  ${linkedPatients} row(s)`);
  logger.info(`  patients (walk-in)       ${walkInPatients} row(s)`);
  logger.info(`  users (disposable)       ${disposableUsersCount} row(s)`);

  if (confirmed) {
    // Patients first: patients.user_id references users.
    await db.query(`DELETE FROM patients WHERE user_id IN (${disposableUsers})`, PROTECTED_EMAILS);
    await db.query(`DELETE FROM user_roles WHERE user_id IN (${disposableUsers})`, PROTECTED_EMAILS);
    await db.query(`DELETE FROM users WHERE email NOT IN (${placeholders})`, PROTECTED_EMAILS);
    // Staff-owned patient profiles (walk-ins registered by reception) have no user_id and are
    // removed wholesale — every one of them belongs to a cleared visit by this point.
    await db.query('DELETE FROM patients WHERE user_id IS NULL');
    logger.info('Reset complete. Reference data and seeded accounts left intact.');
    logger.info('Re-run `node src/scripts/seedUsers.js` if any seeded account is missing.');
  } else {
    logger.info('DRY RUN finished — no changes were made.');
  }

  process.exit(0);
}

main().catch((err) => {
  logger.error(`Reset failed: ${err.message}`);
  process.exit(1);
});
