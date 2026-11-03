/**
 * Retention pass for HMO card images. [1.148.0] The server runs it itself once a day
 * (jobs/retentionScheduler.js, through services/retentionService.js), at the 365 days below; this
 * shows what is due, and with --confirm removes it now.
 *
 * An HMO card carries a member number, a name and often a photo. Unlike a diagnostic result it is
 * not a medical record — it is evidence for one claim, and once that claim is long settled the
 * clinic has no reason to keep the image. Nothing else in this project deletes anything on a
 * schedule except pruneNotifications.js, so without this the clinic accumulates insurance cards
 * forever.
 *
 * Anchored on request_date rather than on settlement. A claim that nobody ever actioned would
 * never expire under a settlement rule, and "we still hold this patient's insurance card because
 * an admin forgot about it" is the wrong way round.
 *
 * What it removes: the image file, and the metadata pointing at it. card_purged_at is stamped so
 * a purged card stays distinguishable from one that was never provided — Admin can then see that
 * evidence existed and was removed under policy, rather than a gap in the record. The claim, its
 * approval and its linked tests are untouched.
 *
 * Dry-run BY DEFAULT, unlike pruneNotifications: this deletes patient documents.
 *   node src/scripts/pruneHmoCards.js                 # report only, deletes nothing
 *   node src/scripts/pruneHmoCards.js --days=180      # different window, still a dry run
 *   node src/scripts/pruneHmoCards.js --confirm       # actually delete
 *
 * Changing the policy is one line in services/retentionService.js (RETENTION.hmoCardDays), or a
 * flag here for one run; RETENTION=off stops the server's daily pass.
 */
const retentionService = require('../services/retentionService');
const logger = require('../config/logger');

const DEFAULT_RETENTION_DAYS = retentionService.RETENTION.hmoCardDays;

function numericArg(name, fallback) {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split('=')[1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main() {
  const retentionDays = numericArg('days', DEFAULT_RETENTION_DAYS);
  const confirmed = process.argv.includes('--confirm');

  const rows = await retentionService.hmoCardsPastRetention({ days: retentionDays });

  logger.info(`Retention: ${retentionDays} days${confirmed ? '' : ' (DRY RUN)'}`);
  logger.info(`${rows.length} card image(s) past the retention window.`);

  if (!rows.length) {
    process.exit(0);
  }

  if (!confirmed) {
    for (const row of rows.slice(0, 10)) {
      logger.info(`  would remove request #${row.id} (${row.request_date.toISOString().slice(0, 10)})`);
    }
    if (rows.length > 10) logger.info(`  …and ${rows.length - 10} more`);
    logger.info('DRY RUN — nothing deleted. Re-run with --confirm to apply.');
    process.exit(0);
  }

  const removed = await retentionService.pruneHmoCards({ days: retentionDays });
  logger.info(`Done. ${removed} card image(s) removed; their claims and approvals are untouched.`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`HMO card retention pass failed: ${err.message}`);
  process.exit(1);
});
