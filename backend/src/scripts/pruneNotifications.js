/**
 * Retention pass for the notification fan-out tables. Run on a schedule.
 *
 * Why this is needed: notification_reads holds one row per recipient per event, so it grows as
 * events x staff rather than as events. Nothing had ever deleted from it. On the development
 * database that reached 255,540 rows across 4,309 events in five days — an average fan-out of 60
 * and a peak of 181 — of which 253,893 (99.4%) had never been read by anybody. The notification
 * bell shows a short list; it does not need years of history behind it to do that.
 *
 * Production is not immune just because staff counts are stable there. Twenty staff and two
 * hundred events a day is 4,000 rows a day, about 1.5 million a year, growing forever. It is the
 * table that degrades first, and it degrades quietly: reads stay fast until the index no longer
 * fits comfortably in cache.
 *
 * Defaults: read notifications live 30 days, unread ones 90. Override per run:
 *   node src/scripts/pruneNotifications.js
 *   node src/scripts/pruneNotifications.js --read-days=14 --unread-days=60
 *   node src/scripts/pruneNotifications.js --dry-run
 *
 * Suggested schedule: daily, off-peak. Windows Task Scheduler or cron both work; there is no
 * in-process scheduler in this app and adding one for a single periodic job would be heavier
 * than the job itself.
 */
const notificationRepository = require('../repositories/notificationRepository');
const logger = require('../config/logger');

const DEFAULT_READ_DAYS = 30;
const DEFAULT_UNREAD_DAYS = 90;

function numericArg(name, fallback) {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split('=')[1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main() {
  const readAfterDays = numericArg('read-days', DEFAULT_READ_DAYS);
  const unreadAfterDays = numericArg('unread-days', DEFAULT_UNREAD_DAYS);
  const dryRun = process.argv.includes('--dry-run');

  const before = await notificationRepository.countAll();
  logger.info(`Before: ${before.events} events, ${before.reads} recipient rows`);
  logger.info(`Retention: read ${readAfterDays}d, unread ${unreadAfterDays}d${dryRun ? ' (DRY RUN)' : ''}`);

  if (dryRun) {
    logger.info('DRY RUN — nothing deleted. Re-run without --dry-run to apply.');
    process.exit(0);
  }

  const result = await notificationRepository.pruneOlderThan({ readAfterDays, unreadAfterDays });
  const after = await notificationRepository.countAll();

  logger.info(`Deleted ${result.readRowsDeleted} read row(s), ${result.staleRowsDeleted} stale row(s), ${result.eventsDeleted} orphaned event(s)`);
  logger.info(`After:  ${after.events} events, ${after.reads} recipient rows`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Prune failed: ${err.message}`);
  process.exit(1);
});
