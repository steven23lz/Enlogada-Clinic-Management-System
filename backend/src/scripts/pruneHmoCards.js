/**
 * Retention pass for HMO card images. Schedule this wherever the system runs for longer than a
 * demo.
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
 * Changing the policy is a one-line edit here or a flag at the call site; turning it off entirely
 * means not scheduling it. Nothing about the retention period is baked into the application.
 */
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../config/logger');
const { HMO_CARD_UPLOAD_ROOT } = require('../config/upload');

const DEFAULT_RETENTION_DAYS = 365;

function numericArg(name, fallback) {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split('=')[1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main() {
  const retentionDays = numericArg('days', DEFAULT_RETENTION_DAYS);
  const confirmed = process.argv.includes('--confirm');

  const { rows } = await db.query(
    `SELECT id, card_file_path, request_date
     FROM hmo_requests
     WHERE card_file_path IS NOT NULL
       AND card_purged_at IS NULL
       AND request_date < NOW() - ($1 || ' days')::interval
     ORDER BY request_date`,
    [retentionDays]
  );

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

  let removed = 0;
  for (const row of rows) {
    // The row is updated first: it is the source of truth for whether a card is still on file,
    // and a stamped row pointing at a file that happens to survive is recoverable, whereas a
    // deleted file with a row still claiming it exists produces a broken link for Admin.
    await db.query(
      `UPDATE hmo_requests
       SET card_file_path = NULL, card_original_name = NULL, card_mime_type = NULL,
           card_size_bytes = NULL, card_purged_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id]
    );

    // Best-effort, matching every other file deletion in this codebase: losing the row is what
    // matters, and a stray file is picked up by the orphan sweep.
    try {
      fs.unlinkSync(path.join(HMO_CARD_UPLOAD_ROOT, row.card_file_path));
    } catch (err) {
      logger.warn(`  could not remove file for request #${row.id}: ${err.message}`);
    }
    removed += 1;
  }

  logger.info(`Done. ${removed} card image(s) removed; their claims and approvals are untouched.`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`HMO card retention pass failed: ${err.message}`);
  process.exit(1);
});
