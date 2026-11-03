/**
 * The server's own patient emails, by hand. [1.148.0]
 *
 * The server sends them by itself (jobs/patientMessageScheduler.js), so nothing needs scheduling.
 * This shows who is owed one and what a sweep would do now, and can run one sweep by hand:
 *
 *   node src/scripts/sendPatientMessages.js             # the plan
 *   node src/scripts/sendPatientMessages.js --json      # the same, as JSON
 *   node src/scripts/sendPatientMessages.js --confirm   # send what is due right now
 *
 * Three kinds: resultsReady, missedBooking, feedbackInvite (services/patientMessageService.js).
 * Safe beside the server: each email is claimed before it is sent, so it still goes out once.
 */
const logger = require('../config/logger');
const db = require('../config/database');
const patientMessageService = require('../services/patientMessageService');

async function main() {
  const now = new Date();

  if (process.argv.includes('--confirm')) {
    const counts = await patientMessageService.sweep(now);
    if (counts.notConfigured) {
      logger.warn(`Outbound mail is not configured (${counts.notConfigured.join(', ')}); nothing sent.`);
    } else {
      logger.info(`${counts.sent} sent, ${counts.noAddress} with no address, ${counts.skipped} too late to send, ${counts.failed} failed.`);
    }
    return;
  }

  const plan = (await patientMessageService.plan({ now })).map(({ kind, id, row, decision }) => ({
    kind,
    id,
    patient: `${row.first_name} ${row.last_name}`,
    to: row.email || null,
    action: decision.action,
    at: decision.at || null,
    reason: decision.reason || null,
  }));

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return;
  }
  if (!plan.length) {
    logger.info('Nobody is owed a patient email right now.');
    return;
  }
  for (const p of plan) {
    logger.info(`${p.kind.padEnd(15)} #${p.id}  ${p.patient.padEnd(28)} ${p.action}${p.reason ? ` (${p.reason})` : ''}`);
  }
}

main()
  .catch((err) => {
    logger.error(`Patient email plan failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
