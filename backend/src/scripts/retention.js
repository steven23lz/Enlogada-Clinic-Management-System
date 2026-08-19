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
    windowFlags: ['read-days', 'unread-days'],
    dryFlag: '--dry-run',
    note: 'read 30d, unread 90d',
  },
  {
    name: 'audit log',
    script: 'pruneAuditLog.js',
    dryFlag: '--dry-run',
    note: 'PHI reads 2y, everything else 7y',
    windowFlags: ['phi-days', 'other-days'],
  },
  {
    name: 'HMO cards',
    script: 'pruneHmoCards.js',
    applyFlag: '--confirm',
    note: '365d, patient documents',
    windowFlags: ['days'],
  },
];

function main() {
  const confirmed = process.argv.includes('--confirm');

  // --dry-run and --confirm together used to mean different things to different passes: the two
  // that read --dry-run honoured it and deleted nothing, while the one that does not read it
  // ignored the flag and deleted anyway. So the single most cautious-looking way to invoke this
  // was also the one that removed patient documents. Refuse the combination outright.
  if (confirmed && process.argv.includes('--dry-run')) {
    logger.error('--confirm and --dry-run contradict each other. Omit --confirm for a dry run.');
    process.exit(2);
  }

  // Window overrides are matched to the pass that actually parses them. Forwarding every argument
  // to every pass meant `--days=30` looked global and was not: only the HMO card pass reads
  // --days, so it silently retargeted the patient-document window alone and left the other two
  // at their defaults.
  const overrides = process.argv.slice(2).filter((a) => a.startsWith('--') && a.includes('='));
  const known = new Set(PASSES.flatMap((p) => p.windowFlags || []));

  // Every --flag is checked, not only the --flag=value form. `--days 800` parses as two separate
  // arguments, so a check that only looked at args containing '=' saw no override and no unknown
  // option — the runner said nothing and the pass silently used its default window. On the HMO
  // card pass that means deleting every insurance document older than the default while the
  // operator believed they had widened it.
  const CONTROL_FLAGS = new Set(['--confirm', '--dry-run']);
  const unknown = process.argv
    .slice(2)
    .filter((a) => a.startsWith('--') && !CONTROL_FLAGS.has(a))
    .filter((a) => !known.has(a.slice(2).split('=')[0]) || !a.includes('='));
  if (unknown.length) {
    logger.error(`Unrecognised or malformed option(s): ${unknown.join(', ')}`);
    logger.error('Windows take the form --flag=value; a space is not accepted.');
    logger.error(`Windows this runner understands: ${[...known].map((f) => '--' + f + '=N').join(', ')}`);
    process.exit(2);
  }

  logger.info(`Retention: ${PASSES.length} pass(es)${confirmed ? '' : ' — DRY RUN, nothing will be deleted'}`);

  const failures = [];
  for (const pass of PASSES) {
    logger.info(`── ${pass.name} (${pass.note}) ─────────────────────────────`);

    // Only the overrides this pass understands. An option meant for another pass would otherwise
    // be silently ignored here, which reads as "applied" to whoever typed it.
    const mine = overrides.filter((a) => (pass.windowFlags || []).includes(a.slice(2).split('=')[0]));
    if (mine.length) logger.info(`   override: ${mine.join(' ')}`);
    const args = [path.join(__dirname, pass.script), ...mine];
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
