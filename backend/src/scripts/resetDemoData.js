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
const fs = require('fs');
const path = require('path');
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

/**
 * Removes uploaded result files that no database row references any more.
 *
 * Compares the files on disk against test_results.file_path and deletes only the difference, so
 * a file belonging to a surviving result is never at risk. Failures are reported rather than
 * thrown: losing a stray file is not worth aborting a reset over.
 */
async function pruneOrphanedResultFiles() {
  const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads', 'results');
  if (!fs.existsSync(uploadsDir)) return;

  const referenced = new Set(
    (await db.query('SELECT file_path FROM test_results WHERE file_path IS NOT NULL')).rows
      .map((r) => path.basename(r.file_path))
  );

  let removed = 0;
  for (const name of fs.readdirSync(uploadsDir)) {
    if (referenced.has(name)) continue;
    try {
      fs.unlinkSync(path.join(uploadsDir, name));
      removed += 1;
    } catch (err) {
      logger.warn(`  could not remove orphaned file ${name}: ${err.message}`);
    }
  }
  logger.info(`  orphaned result files    ${removed} removed`);
}

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

    // Uploaded result files whose database row has just been deleted.
    //
    // Nothing in the app has ever removed a result file from disk — resultRepository's upsert
    // says so explicitly, and this script inherited the same gap: it cleared test_results and
    // left the PDFs and images behind. Harmless while they are 50-byte test fixtures, and not
    // harmless at all in production, where they are real scans accumulating with no ceiling and
    // no reference pointing at them. Same shape as the notification fan-out, just slower.
    //
    // Deletes only files the database no longer knows about, so a file belonging to a surviving
    // result is never touched.
    await pruneOrphanedResultFiles();
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
