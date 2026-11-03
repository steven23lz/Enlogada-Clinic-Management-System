const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const env = require('../config/environment');
const db = require('../config/database');
const auditRepository = require('../repositories/auditRepository');
const auditService = require('./auditService');
const logger = require('../config/logger');
const {
  backupFileName, backupDue, filesToDelete, removedFoldersToDelete, dayFolder,
} = require('../utils/backupPlan');
const { encryptFile } = require('../utils/backupCrypto');

/**
 * The nightly backup. [1.148.0]
 *
 * Nothing backed up the clinic's data: a failed disk on the clinic PC would have taken every
 * patient record, result and receipt with it. Now the server makes one itself (jobs/
 * backupScheduler.js): the database with pg_dump, and the uploaded files (reports, doctor's
 * requests, IDs, payment proofs) mirrored beside it. The rules of when, and what to delete, are
 * `utils/backupPlan.js`; how to restore is docs/BACKUP_AND_RESTORE.md and scripts/restoreBackup.js.
 *
 * - Where: BACKUP_DIR, by default a folder beside the app's own ("enlogada-backups"), so a
 *   `git clean` or a fresh checkout never touches it. BACKUP_COPY_DIR adds a second copy: another
 *   drive, or a folder a cloud client syncs. One disk holding the data and its only backup is not
 *   a backup against that disk failing.
 * - Encrypted when BACKUP_PASSPHRASE is set (utils/backupCrypto.js), which a copy that leaves the
 *   PC should always be.
 * - Uploads are MIRRORED, not copied whole each night: a file the app removes (an unpaid visit's
 *   request, an HMO card past retention) is moved to uploads-removed/<day> and deleted after the
 *   same 30 days as the dumps, so a deletion can be undone for a month and retention still holds.
 * - Once across servers: the run holds an advisory lock, and "due" is read from the Activity Log,
 *   so two servers on one database make one backup.
 * - Every outcome is an Activity Log line, and Today warns an Admin when the newest is failing or
 *   old. A backup nobody hears has failed is how the clinic would find out on the day it needed it.
 */
const ACTIONS = Object.freeze({ made: 'system.backup_made', failed: 'system.backup_failed' });
const ACTOR = 'System (backup)';
const MIN_KEEP = 7;
const UPLOADS = path.join(__dirname, '..', '..', 'uploads');
const SKIP_UPLOAD_DIRS = new Set(['.ocr-cache']); // scratch, rebuilt on demand
const APP_ROOT = path.join(__dirname, '..', '..', '..');
const DUMP_TIMEOUT_MS = 15 * 60 * 1000;

const folder = () => (env.BACKUP_DIR ? path.resolve(env.BACKUP_DIR) : path.join(APP_ROOT, '..', 'enlogada-backups'));
const copyFolder = () => (env.BACKUP_COPY_DIR ? path.resolve(env.BACKUP_COPY_DIR) : null);

const megabytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** pg_dump or pg_restore: PG_DUMP_PATH's folder, then PATH, then a standard Windows install. */
function findPgTool(tool) {
  const exe = process.platform === 'win32' ? `${tool}.exe` : tool;
  if (env.PG_DUMP_PATH) {
    const configured = path.join(path.dirname(env.PG_DUMP_PATH), exe);
    return fs.existsSync(configured) ? configured : (tool === 'pg_dump' ? env.PG_DUMP_PATH : null);
  }
  if (spawnSync(tool, ['--version'], { windowsHide: true }).status === 0) return tool;
  if (process.platform === 'win32') {
    const base = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
    try {
      const versions = fs.readdirSync(base)
        .filter((v) => fs.existsSync(path.join(base, v, 'bin', exe)))
        .sort((a, b) => Number(b) - Number(a));
      if (versions.length) return path.join(base, versions[0], 'bin', exe);
    } catch {
      // No PostgreSQL folder: fall through to "not found".
    }
  }
  return null;
}

/** DATABASE_URL as pg_dump's arguments, with the password in its environment, never on argv. */
function connectionFor(url) {
  const u = new URL(url);
  const args = [
    '-h', u.hostname || 'localhost',
    '-p', u.port || '5432',
    '-U', decodeURIComponent(u.username),
    '-d', decodeURIComponent(u.pathname.replace(/^\//, '')),
  ];
  const vars = {};
  if (u.password) vars.PGPASSWORD = decodeURIComponent(u.password);
  if (u.searchParams.get('sslmode')) vars.PGSSLMODE = u.searchParams.get('sslmode');
  return { args, env: vars };
}

function runTool(command, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...extraEnv }, windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => child.kill(), DUMP_TIMEOUT_MS);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error((stderr.trim().split('\n').pop() || `${path.basename(command)} exited with ${code}`).trim()));
    });
  });
}

/** Every file under `root`, as paths relative to it. */
async function listFiles(root, { skipTop = new Set() } = {}) {
  const out = [];
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (!rel && skipTop.has(entry.name)) continue;
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), childRel);
      else if (entry.isFile() && !entry.name.endsWith('.partial')) out.push(childRel);
    }
  }
  await walk(root, '');
  return out;
}

/**
 * Brings `target/uploads` level with the app's uploads: copies what is new or changed, and moves
 * what the app has removed into `uploads-removed/<today>` rather than deleting it.
 */
async function mirrorUploads(target, { passphrase, now }) {
  const dest = path.join(target, 'uploads');
  const removedRoot = path.join(target, 'uploads-removed', dayFolder(now));
  const suffix = passphrase ? '.enc' : '';
  const kept = new Set();
  let copied = 0;
  let removed = 0;

  for (const rel of await listFiles(UPLOADS, { skipTop: SKIP_UPLOAD_DIRS })) {
    const from = path.join(UPLOADS, rel);
    const to = path.join(dest, rel + suffix);
    kept.add(rel + suffix);
    const [src, existing] = await Promise.all([fsp.stat(from), fsp.stat(to).catch(() => null)]);
    if (existing && existing.mtimeMs >= src.mtimeMs) continue;
    await fsp.mkdir(path.dirname(to), { recursive: true });
    const partial = `${to}.partial`;
    if (passphrase) await encryptFile(from, partial, passphrase);
    else await fsp.copyFile(from, partial);
    await fsp.rename(partial, to);
    copied += 1;
  }

  for (const rel of await listFiles(dest)) {
    if (kept.has(rel)) continue;
    const to = path.join(removedRoot, rel);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(path.join(dest, rel), to);
    removed += 1;
  }
  return { copied, removed };
}

/** Deletes dumps and removed-upload folders past the keep window, in one backup folder. */
async function prune(target, now) {
  const names = await fsp.readdir(target).catch(() => []);
  const dumps = filesToDelete(names, { now, keepDays: env.BACKUP_KEEP_DAYS, minKeep: MIN_KEEP });
  for (const name of dumps) await fsp.rm(path.join(target, name), { force: true });

  const removedRoot = path.join(target, 'uploads-removed');
  const days = await fsp.readdir(removedRoot).catch(() => []);
  for (const day of removedFoldersToDelete(days, { now, keepDays: env.BACKUP_KEEP_DAYS })) {
    await fsp.rm(path.join(removedRoot, day), { recursive: true, force: true });
  }
  return dumps.length;
}

class BackupService {
  constructor() {
    this.lastFailureAt = null;
    this.lastFailureMessage = null;
  }

  folder() {
    return folder();
  }

  /** The newest success and failure, from the Activity Log (shared by every server). */
  async lastOutcome() {
    const latest = await auditRepository.findLatestForEntityType('backup', Object.values(ACTIONS));
    const loggedFailure = latest[ACTIONS.failed]?.created_at || null;
    const memoryFailure = this.lastFailureAt;
    return {
      lastSuccessAt: latest[ACTIONS.made]?.created_at || null,
      lastSuccess: latest[ACTIONS.made]?.description || null,
      lastFailureAt: [loggedFailure, memoryFailure].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null,
      lastFailure: latest[ACTIONS.failed]?.description || null,
    };
  }

  /** What Today and the status endpoint show. Reads only. */
  async status() {
    const last = await this.lastOutcome();
    return {
      enabled: env.BACKUPS,
      byHost: env.BACKUPS_BY_HOST,
      folder: this.folder(),
      secondCopy: Boolean(copyFolder()),
      encrypted: Boolean(env.BACKUP_PASSPHRASE),
      at: env.BACKUP_AT,
      keepDays: env.BACKUP_KEEP_DAYS,
      ...last,
    };
  }

  /** The scheduler's sweep: makes a backup if one is due, and only one across servers. */
  async runIfDue(now = new Date()) {
    return db.withTransaction(async () => {
      if (!(await this.lock())) return { ran: false, why: 'running elsewhere' };
      const last = await this.lastOutcome();
      if (!backupDue({ ...last, now, at: env.BACKUP_AT })) return { ran: false, why: 'not due' };
      return { ran: true, ...(await this.runAndRecord({ now })) };
    });
  }

  /** A backup now, whatever the schedule says (scripts/backupNow.js). */
  async runNow({ now = new Date(), actorName = 'System (backup, by hand)' } = {}) {
    return db.withTransaction(async () => {
      if (!(await this.lock())) return { ran: false, why: 'running elsewhere' };
      return { ran: true, ...(await this.runAndRecord({ now, actorName })) };
    });
  }

  async lock() {
    const { rows } = await db.query("SELECT pg_try_advisory_xact_lock(hashtext('enlogada.backup')) AS ok");
    return rows[0].ok;
  }

  async runAndRecord({ now, actorName = ACTOR }) {
    try {
      const made = await this.make(now);
      this.lastFailureAt = null;
      this.lastFailureMessage = null;
      await auditService.log({
        actorName,
        action: ACTIONS.made,
        entityType: 'backup',
        entityId: null,
        description: `Backed up the database (${made.name}, ${megabytes(made.bytes)})`
          + `${made.encrypted ? ', encrypted' : ''}${made.secondCopy ? ', with a second copy' : ''}; `
          + `${made.uploads.copied} new uploaded file(s) copied`
          + `${made.uploads.removed ? `, ${made.uploads.removed} removed by the app kept for ${env.BACKUP_KEEP_DAYS} days` : ''}.`,
      });
      logger.info(`Backup made: ${made.file} (${megabytes(made.bytes)}).`);
      return { ok: true, ...made };
    } catch (err) {
      const message = err.message || String(err);
      // One Activity Log line per new problem, not one an hour while it lasts.
      const repeat = this.lastFailureMessage === message;
      this.lastFailureAt = now;
      this.lastFailureMessage = message;
      if (!repeat) {
        await auditService.log({
          actorName, action: ACTIONS.failed, entityType: 'backup', entityId: null,
          description: `Backup failed: ${message}`,
        });
      }
      logger.error(`Backup failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  /** The work itself: dump, encrypt, copy, mirror, prune. Throws on any failure. */
  async make(now) {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
    const pgDump = findPgTool('pg_dump');
    if (!pgDump) throw new Error("pg_dump was not found. Install PostgreSQL's command-line tools, or set PG_DUMP_PATH.");

    const target = this.folder();
    await fsp.mkdir(target, { recursive: true });
    const passphrase = env.BACKUP_PASSPHRASE || null;
    const name = backupFileName(now, { encrypted: Boolean(passphrase) });
    const finalPath = path.join(target, name);
    const plain = path.join(target, `.in-progress-${process.pid}.dump`);

    try {
      const conn = connectionFor(env.DATABASE_URL);
      await runTool(pgDump, [...conn.args, '--format=custom', '--file', plain], conn.env);
      // A custom-format dump starts with "PGDMP"; anything else is not a backup worth keeping.
      const head = Buffer.alloc(5);
      const fd = await fsp.open(plain, 'r');
      try { await fd.read(head, 0, 5, 0); } finally { await fd.close(); }
      if (head.toString() !== 'PGDMP') throw new Error('pg_dump finished, but its file is not a database backup.');

      if (passphrase) {
        await encryptFile(plain, `${finalPath}.partial`, passphrase);
        await fsp.rename(`${finalPath}.partial`, finalPath);
      } else {
        await fsp.rename(plain, finalPath);
      }
    } finally {
      await fsp.rm(plain, { force: true });
      await fsp.rm(`${finalPath}.partial`, { force: true });
    }
    const { size: bytes } = await fsp.stat(finalPath);

    const uploads = await mirrorUploads(target, { passphrase, now });
    await prune(target, now);

    const second = copyFolder();
    if (second) {
      await fsp.mkdir(second, { recursive: true });
      await fsp.copyFile(finalPath, path.join(second, `${name}.partial`));
      await fsp.rename(path.join(second, `${name}.partial`), path.join(second, name));
      await mirrorUploads(second, { passphrase, now });
      await prune(second, now);
    }
    return { name, file: finalPath, bytes, encrypted: Boolean(passphrase), secondCopy: Boolean(second), uploads };
  }
}

module.exports = new BackupService();
module.exports.findPgTool = findPgTool;
module.exports.connectionFor = connectionFor;
module.exports.UPLOADS = UPLOADS;
module.exports.BACKUP_ACTIONS = ACTIONS;
