/**
 * Restores a backup made by the server (services/backupService.js). [1.148.0]
 *
 *   node src/scripts/restoreBackup.js                                   # the backups there are, newest first
 *   node src/scripts/restoreBackup.js --file=enlogada-2026-11-04-1800.dump            # what it would do
 *   node src/scripts/restoreBackup.js --file=… --into=enlogada_check --confirm        # into a NEW database
 *   node src/scripts/restoreBackup.js --file=… --confirm                              # over the live one
 *   node src/scripts/restoreBackup.js --uploads --confirm                             # put back missing files
 *
 * --into restores into a separate, empty database and touches nothing else: the safe way to check
 * that a backup is good, and the first step of any real restore. Without it the backup REPLACES
 * the database in DATABASE_URL: stop the server first, and a backup of the current state is made
 * before anything is replaced, so even a restore can be undone.
 *
 * --uploads copies back every uploaded file the app's uploads folder is missing, and never
 * overwrites one that is there. Encrypted backups (.enc) need BACKUP_PASSPHRASE.
 *
 * --dir=PATH reads backups from a folder other than BACKUP_DIR (the second copy, a USB drive).
 * Step by step, for the clinic: docs/BACKUP_AND_RESTORE.md.
 */
require('dotenv').config();
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const env = require('../config/environment');
const db = require('../config/database');
const backupService = require('../services/backupService');
const { backupFileDate } = require('../utils/backupPlan');
const { decryptFile, isEncryptedName } = require('../utils/backupCrypto');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const has = (flag) => process.argv.includes(`--${flag}`);

const dir = arg('dir') ? path.resolve(arg('dir')) : backupService.folder();
const confirmed = has('confirm');

function run(command, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...extraEnv }, windowsHide: true, stdio: ['ignore', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(stderr) : reject(new Error(stderr.trim().split('\n').slice(-3).join(' ') || `exit ${code}`))));
  });
}

function needPassphrase(name) {
  if (isEncryptedName(name) && !env.BACKUP_PASSPHRASE) {
    throw new Error('This backup is encrypted: set BACKUP_PASSPHRASE to the passphrase it was made with.');
  }
}

async function list() {
  const names = (await fsp.readdir(dir).catch(() => [])).filter((n) => backupFileDate(n))
    .sort((a, b) => backupFileDate(b) - backupFileDate(a));
  console.log(`\n  Backups in ${dir}:\n`);
  if (!names.length) console.log('  none.');
  for (const n of names) {
    const { size } = fs.statSync(path.join(dir, n));
    console.log(`  ${n}  ${(size / (1024 * 1024)).toFixed(1)} MB${isEncryptedName(n) ? '  (encrypted)' : ''}`);
  }
  console.log('\n  Restore one with --file=NAME (a dry run until --confirm). See docs/BACKUP_AND_RESTORE.md.\n');
}

async function restoreDatabase(fileArg) {
  const file = path.isAbsolute(fileArg) ? fileArg : path.join(dir, fileArg);
  if (!fs.existsSync(file)) throw new Error(`No such backup: ${file}`);
  needPassphrase(file);
  const into = arg('into');
  if (into && !/^[a-z_][a-z0-9_]*$/.test(into)) throw new Error('--into takes a database name of lowercase letters, digits and _.');

  const conn = backupService.connectionFor(env.DATABASE_URL);
  const live = conn.args[conn.args.indexOf('-d') + 1];
  const target = into || live;

  console.log(`\n  Backup:   ${file}`);
  console.log(`  Restore:  into ${into ? `a new database "${into}"` : `the LIVE database "${live}", replacing what is there`}`);
  if (!into) console.log('  First:    a backup of the live database as it is now');
  if (!confirmed) {
    console.log('\n  Dry run: nothing changed. Add --confirm to do it.\n');
    return;
  }

  const pgRestore = backupService.findPgTool('pg_restore');
  if (!pgRestore) throw new Error("pg_restore was not found. Install PostgreSQL's command-line tools, or set PG_DUMP_PATH.");

  if (into) {
    const exists = await db.query('SELECT 1 FROM pg_database WHERE datname = $1', [into]);
    if (exists.rowCount) throw new Error(`Database "${into}" already exists. Choose a new name, or drop it first.`);
    await db.query(`CREATE DATABASE ${into}`);
  } else {
    const safety = await backupService.runNow({ actorName: 'System (backup before a restore)' });
    if (!safety.ran || !safety.ok) throw new Error(`The backup of the current state failed, so nothing was replaced: ${safety.error || safety.why}`);
    console.log(`  Current state saved: ${safety.file}`);
  }

  let source = file;
  let temp = null;
  if (isEncryptedName(file)) {
    temp = path.join(os.tmpdir(), `enlogada-restore-${process.pid}.dump`);
    await decryptFile(file, temp, env.BACKUP_PASSPHRASE);
    source = temp;
  }
  try {
    const args = [...conn.args, '--no-owner', '--exit-on-error'];
    args[args.indexOf('-d') + 1] = target;
    if (!into) args.push('--clean', '--if-exists', '--single-transaction');
    args.push(source);
    await run(pgRestore, args, conn.env);
  } finally {
    if (temp) await fsp.rm(temp, { force: true });
  }
  console.log(`\n  Restored into "${target}".${into ? ' The live database was not touched.' : ' Start the server again.'}\n`);
}

async function restoreUploads() {
  const from = path.join(dir, 'uploads');
  const to = backupService.UPLOADS;
  const missing = [];
  async function walk(rel) {
    for (const entry of await fsp.readdir(path.join(from, rel), { withFileTypes: true }).catch(() => [])) {
      const childRel = path.join(rel, entry.name);
      if (entry.isDirectory()) await walk(childRel);
      else if (entry.isFile()) {
        const plainRel = isEncryptedName(childRel) ? childRel.slice(0, -4) : childRel;
        if (!fs.existsSync(path.join(to, plainRel))) missing.push({ rel: childRel, plainRel });
      }
    }
  }
  await walk('');
  console.log(`\n  ${missing.length} uploaded file(s) in the backup are missing from ${to}.`);
  if (!confirmed || !missing.length) {
    if (missing.length) console.log('  Dry run: nothing copied. Add --confirm to copy them back.\n');
    return;
  }
  for (const { rel, plainRel } of missing) {
    const target = path.join(to, plainRel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if (isEncryptedName(rel)) {
      needPassphrase(rel);
      await decryptFile(path.join(from, rel), target, env.BACKUP_PASSPHRASE);
    } else {
      await fsp.copyFile(path.join(from, rel), target);
    }
  }
  console.log(`  Copied back ${missing.length} file(s). Nothing that was there was overwritten.\n`);
}

(async () => {
  try {
    if (has('uploads')) await restoreUploads();
    else if (arg('file')) await restoreDatabase(arg('file'));
    else await list();
  } catch (err) {
    console.error(`\n  Failed: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
