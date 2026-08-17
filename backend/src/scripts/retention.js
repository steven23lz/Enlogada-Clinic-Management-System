/**
 * Runs every retention pass, so a deployment schedules ONE thing instead of three.
 *
 * Three passes exist — notification fan-out, audit log, HMO card images — and each documents its
 * own suggested cadence. Nothing scheduled any of them, which is the predictable outcome of
 * asking an operator to remember three commands with three different flag conventions: the
 * notification table reached 255,540 rows on a development database in five days because nobody
 * was running the thing that would have stopped it.
 *
 *   node src/scripts/retention.js             # report what each pass would remove; deletes nothing
 *   node src/scripts/retention.js --confirm   # apply all three
 *
 * ── Why dry-run is the default here ───────────────────────────────────────────────────────────
 * The three passes disagree, and the disagreement is deliberate rather than sloppy:
 * pruneNotifications and pruneAuditLog apply unless told `--dry-run`, because they delete the
 * clinic's own operational chatter; pruneHmoCards refuses to act without `--confirm`, because it
 * deletes patient documents. A runner has to pick one, and the only safe way to pick is to take
 * the strictest of what it wraps. Running this with no flag can never delete anything.
 *
 * ── Cadence ───────────────────────────────────────────────────────────────────────────────────
 * Daily is right for all three even though the audit pass suggests monthly. A monthly pass does
 * not delete different rows from a daily one — it deletes the same rows later, in a much bigger
 * batch, which is the version more likely to be noticed as a load spike. Each pass is a cheap
 * no-op on a day when nothing has aged past its window.
 *
 *   Windows (as an Administrator prompt, adjust the path):
 *     schtasks /create /tn "Enlogada retention" /sc daily /st 02:30 ^
 *       /tr "node \"C:\\path\\to\\backend\\src\\scripts\\retention.js\" --confirm"
 *
 *   Linux/macOS (crontab -e):
 *     30 2 * * *  cd /path/to/backend && node src/scripts/retention.js --confirm
 *
 * Exit code is non-zero if any pass failed, so a scheduler surfaces it rather than reporting a
 * silent success — a retention job that has been failing for a month looks exactly like one that
 * has been working, right up until the disk fills.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const logger = require('../config/logger');

// Each pass, with how it is told to hold back. `dryFlag` is what suppresses deletion; `applyFlag`
// is what permits it. Exactly one of the two is set per script — that asymmetry is the flag
// inconsistency this runner exists to hide from whoever schedules it.
const PASSES = [
  {
    name: 'notifications',
    script: 'pruneNotifications.js',
    dryFlag: '--dry-run',
    note: 'read 30d, unread 90d',
  },
  {
    name: 'audit log',
    script: 'pruneAuditLog.js',
    dryFlag: '--dry-run',
    note: 'PHI reads 2y, everything else 7y',
  },
  {
    name: 'HMO cards',
    script: 'pruneHmoCards.js',
    applyFlag: '--confirm',
    note: '365d, patient documents',
  },
];

function main() {
  const confirmed = process.argv.includes('--confirm');
  // Anything else on the command line is forwarded, so a one-off override still works:
  //   node src/scripts/retention.js --confirm --days=180
  const passthrough = process.argv.slice(2).filter((a) => a !== '--confirm');

  logger.info(`Retention: ${PASSES.length} pass(es)${confirmed ? '' : ' — DRY RUN, nothing will be deleted'}`);

  const failures = [];
  for (const pass of PASSES) {
    logger.info(`── ${pass.name} (${pass.note}) ─────────────────────────────`);

    const args = [path.join(__dirname, pass.script), ...passthrough];
    if (confirmed) {
      if (pass.applyFlag) args.push(pass.applyFlag);
    } else if (pass.dryFlag) {
      args.push(pass.dryFlag);
    }
    // A pass with only an applyFlag needs no dry-run flag: withholding the flag IS the dry run.

    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.error) {
      logger.error(`${pass.name}: could not run — ${result.error.message}`);
      failures.push(pass.name);
    } else if (result.status !== 0) {
      logger.error(`${pass.name}: exited ${result.status}`);
      failures.push(pass.name);
    }
  }

  if (failures.length) {
    logger.error(`Retention finished with ${failures.length} failed pass(es): ${failures.join(', ')}`);
    process.exit(1);
  }
  logger.info(confirmed ? 'Retention complete.' : 'DRY RUN complete — re-run with --confirm to apply.');
  process.exit(0);
}

main();
