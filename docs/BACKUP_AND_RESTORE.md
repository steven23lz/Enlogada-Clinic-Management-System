# Backups, and how to restore one

For whoever looks after the clinic's server. [1.148.0]

## What is backed up, and when

The server backs itself up. Nobody has to remember anything.

- **What:** the whole database (every patient record, visit, result, receipt and account), and
  every uploaded file: reports, doctor's requests, ID photos, HMO cards and payment proofs.
- **When:** once a day after 18:00. If the server is not running at 18:00 (the PC is switched off
  at night), a backup is made a minute after it starts, whenever the last one is more than a day
  old.
- **Where:** a folder called `enlogada-backups` next to the app's own folder, unless `BACKUP_DIR`
  says otherwise. Each day's database is one file, such as `enlogada-2026-11-04-1802.dump`; the
  uploaded files are copied into `uploads` beside it.
- **How long:** 30 days (`BACKUP_KEEP_DAYS`). The newest seven are always kept, whatever their
  age. An uploaded file the app deletes stays in `uploads-removed/<date>` for the same 30 days.
- **Checking it works:** each backup leaves a line in the Activity Log ("Backed up the
  database…"). If one fails, is turned off, or is more than a day and a half old, an Admin's Today
  says so, with the reason.

To make one now (before an update, a restore or a move to another PC):

    cd backend
    node src/scripts/backupNow.js

## A copy that survives the PC

A backup on the same disk as the database does not survive that disk failing. Set a second copy:

    BACKUP_COPY_DIR=E:\Enlogada backups            # a USB drive, or
    BACKUP_COPY_DIR=C:\Users\...\Google Drive\Enlogada backups   # a folder Google Drive syncs
    BACKUP_PASSPHRASE=a long sentence only the clinic knows

With `BACKUP_PASSPHRASE` set, every backup file is encrypted (`.dump.enc`). **A copy that leaves
the PC must be encrypted**: it holds every patient's records. Write the passphrase down and keep
it somewhere other than the backups. Without it, nobody can restore them, the clinic included.

Restart the server after changing these settings.

## Restoring

Always check a backup first by restoring it into a **new, separate** database. This touches
nothing:

    cd backend
    node src/scripts/restoreBackup.js                      # lists the backups, newest first
    node src/scripts/restoreBackup.js --file=enlogada-2026-11-04-1802.dump --into=enlogada_check --confirm

Without `--confirm` it only says what it would do. Restoring from the second copy or a USB drive
adds `--dir="E:\Enlogada backups"`. An encrypted backup needs `BACKUP_PASSPHRASE` set to the
passphrase it was made with.

**Replacing the live database** (the PC's database was lost or damaged):

1. Stop the server.
2. If PostgreSQL itself was reinstalled, create an empty database with the name in `DATABASE_URL`.
3. Run, with the backup you want:

       node src/scripts/restoreBackup.js --file=enlogada-2026-11-04-1802.dump --confirm

   It first backs up the database as it is now, so even a restore can be undone, then replaces it.
4. Put back any uploaded files that are missing:

       node src/scripts/restoreBackup.js --uploads --confirm

   It copies only files that are missing, and never overwrites one that is there.
5. Start the server, and open a recent patient's report to check.

Anything recorded after the backup you restored is gone: a receipt issued that afternoon, a result
released after 18:00. Check the day's receipts against the paper copies.

## Where the system runs

- **On the clinic's own PC, or a rented server with its own disk:** all of the above works as it
  is. PostgreSQL's installer includes `pg_dump` and `pg_restore`, and the server finds them on its
  own (`PG_DUMP_PATH` points at another copy if needed).
- **On a cloud host with a managed database** (Render, Railway, Heroku and the like): the server's
  disk is usually wiped on every deploy, so backups written there disappear, and `pg_dump` may not
  be installed. Use the host's own database backups (often a paid tier), keep uploaded files on a
  persistent disk or object storage, and set `BACKUPS=host`: the server then makes none, and
  Today does not warn about it (`BACKUPS=off` would, every day). The uploaded reports are the harder half there: the app keeps them on the server's
  own disk.
