/**
 * Retention pass for `audit_log`. Schedule this monthly in any long-lived environment.
 *
 * The audit log has never had retention, and PHI read-auditing ([1.19.0]) changes its growth
 * profile completely: it used to record only sensitive *writes* — refunds, staff account changes,
 * HMO approvals, result corrections — perhaps a few dozen rows a day. Now every time a staff
 * member opens a named patient's record, history or report file, that is a row too.
 *
 * This is the same shape as the notification fan-out that reached 255,540 rows before anyone
 * looked: individually reasonable writes, no ceiling, and nothing that ever removes one. The
 * difference is that an audit log is *supposed* to accumulate — the fix is a retention policy
 * matched to the obligation, not a smaller log.
 *
 * Two windows, because the two kinds of entry answer different questions:
 *
 *   PHI READS (phi.read.*) — 2 years.
 *     These answer "who accessed this patient's data?" during a breach investigation. High
 *     volume, and their value drops off sharply once the period they cover has been reviewed.
 *
 *   EVERYTHING ELSE — 7 years.
 *     Refunds, discounts granted, result amendments, staff password resets, account lockouts.
 *     Low volume and long-lived value: these are the entries an auditor, a BIR examination or a
 *     medico-legal dispute asks about, and seven years matches how long the financial records
 *     they describe must be kept anyway.
 *
 * Both are overridable, because the right answer depends on the clinic's own retention policy
 * and this script should not quietly impose one:
 *   node src/scripts/pruneAuditLog.js --dry-run
 *   node src/scripts/pruneAuditLog.js --phi-days=730 --other-days=2555
 *
 * Dry-run reports what it would delete and changes nothing.
 */
const db = require('../config/database');
const logger = require('../config/logger');

const arg = (name, fallback) => {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`));
  return match ? parseInt(match.split('=')[1], 10) : fallback;
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const phiDays = arg('phi-days', 730); // 2 years
  const otherDays = arg('other-days', 2555); // ~7 years

  if (!Number.isFinite(phiDays) || !Number.isFinite(otherDays) || phiDays < 1 || otherDays < 1) {
    logger.error('Retention windows must be positive whole numbers of days.');
    process.exit(1);
  }

  logger.info(
    dryRun
      ? 'DRY RUN — nothing will be deleted.'
      : `Pruning audit_log (PHI reads older than ${phiDays}d, everything else older than ${otherDays}d)…`
  );

  const buckets = [
    {
      label: `PHI read entries older than ${phiDays} days`,
      where: `action LIKE 'phi.read.%' AND created_at < NOW() - ($1 || ' days')::interval`,
      params: [String(phiDays)],
    },
    {
      label: `other entries older than ${otherDays} days`,
      where: `action NOT LIKE 'phi.read.%' AND created_at < NOW() - ($1 || ' days')::interval`,
      params: [String(otherDays)],
    },
  ];

  let removed = 0;
  for (const bucket of buckets) {
    const counted = await db.query(
      `SELECT COUNT(*)::int AS c FROM audit_log WHERE ${bucket.where}`,
      bucket.params
    );
    const n = counted.rows[0].c;
    logger.info(`  ${bucket.label}: ${n}`);
    if (!dryRun && n > 0) {
      await db.query(`DELETE FROM audit_log WHERE ${bucket.where}`, bucket.params);
      removed += n;
    }
  }

  const total = await db.query('SELECT COUNT(*)::int AS c FROM audit_log');
  const phi = await db.query(
    `SELECT COUNT(*)::int AS c FROM audit_log WHERE action LIKE 'phi.read.%'`
  );
  logger.info(
    `${dryRun ? 'DRY RUN finished' : `Done — ${removed} row(s) removed`}. ` +
      `audit_log now holds ${total.rows[0].c} row(s), ${phi.rows[0].c} of them PHI reads.`
  );
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Audit log prune failed: ${err.message}`);
  process.exit(1);
});
