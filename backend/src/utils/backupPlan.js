/**
 * The rules of the nightly backup. [1.148.0] Pure, tested in `tests/backupPlan.test.js`.
 *
 * A backup is due once a day after `at` (18:00, after the clinic closes), and AT ONCE whenever the
 * newest is more than a day old: a clinic PC switched off every evening never reaches 18:00, and a
 * schedule it never reaches is no backup at all. After a failure it waits `retryMinutes` before
 * trying again, so a missing pg_dump is not retried every five minutes all day.
 */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const PREFIX = 'enlogada-';
const NAME = /^enlogada-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.dump(\.enc)?$/;
const pad = (n) => String(n).padStart(2, '0');

/** enlogada-2026-11-04-1800.dump, or .dump.enc when encrypted. Local time: the clinic's day. */
function backupFileName(date, { encrypted = false } = {}) {
  const d = new Date(date);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${PREFIX}${stamp}.dump${encrypted ? '.enc' : ''}`;
}

/** When a backup file was made, from its name; null for anything that is not one of ours. */
function backupFileDate(name) {
  const m = NAME.exec(String(name));
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

/** "18:00" → minutes after midnight; anything unreadable falls back to 18:00. */
function parseClock(value, fallback = 18 * 60) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return fallback;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes < 24 * 60 && Number(m[2]) < 60 ? minutes : fallback;
}

/**
 * Whether a backup should be made now.
 *
 * @param {{lastSuccessAt?: Date|string|null, lastFailureAt?: Date|string|null, now: Date,
 *          at?: string, retryMinutes?: number}} input
 */
function backupDue({ lastSuccessAt = null, lastFailureAt = null, now, at = '18:00', retryMinutes = 60 }) {
  const t = new Date(now);
  const success = lastSuccessAt ? new Date(lastSuccessAt) : null;
  const failure = lastFailureAt ? new Date(lastFailureAt) : null;

  if (failure && (!success || failure > success) && t - failure < retryMinutes * MINUTE) return false;
  if (!success) return true;
  if (t - success >= DAY) return true;

  const todayAt = new Date(t);
  todayAt.setHours(0, parseClock(at), 0, 0);
  return t >= todayAt && success < todayAt;
}

/**
 * The backup files to delete: older than `keepDays`, but never the newest `minKeep`, so a clinic
 * closed for a month comes back to the backups it had rather than to none. Files that are not ours
 * are never touched.
 */
function filesToDelete(names, { now, keepDays = 30, minKeep = 7 }) {
  const ours = names
    .map((name) => ({ name, at: backupFileDate(name) }))
    .filter((f) => f.at)
    .sort((a, b) => b.at - a.at);
  const cutoff = new Date(now).getTime() - keepDays * DAY;
  return ours.slice(minKeep).filter((f) => f.at.getTime() < cutoff).map((f) => f.name);
}

/** The dated folders of removed uploads ("2026-11-04") older than `keepDays`. */
function removedFoldersToDelete(names, { now, keepDays = 30 }) {
  const cutoff = new Date(now).getTime() - keepDays * DAY;
  return names.filter((name) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(name);
    return m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() < cutoff;
  });
}

/** "2026-11-04", the day a removed upload is filed under. */
const dayFolder = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

module.exports = {
  backupFileName, backupFileDate, backupDue, filesToDelete, removedFoldersToDelete, dayFolder, parseClock,
};
