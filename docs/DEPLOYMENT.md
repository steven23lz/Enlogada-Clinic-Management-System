# Putting the system online

For whoever sets up the clinic's hosting. The clinic chose to run it online, so patients can book from home and
staff need internet to work. There is no offline mode: if the internet is down, the desk uses paper until it returns.

## What the host must provide

- **HTTPS**, for both the website and the API. Patients' records and sign-ins pass through them.
- **PostgreSQL**, on the clinic's own database. Use a host in or near the Philippines if the price allows.
- **A disk that survives a redeploy, for `backend/uploads`.** This is the one that catches people out. Reports, doctor's
  requests, ID photos and proofs of payment are files on disk. Many cheap hosts wipe the disk on every deploy, and every
  report would be gone. Choose a host with a persistent disk, and test it: upload a report, redeploy, open the report.
- **One running copy of the backend.** The reminders, backups and clean-ups run inside the server, and claim their work,
  but uploaded files are on one disk.
- **Outgoing email allowed.** Sign-up codes go through Gmail SMTP, and some hosts block mail ports. Send a test sign-up.
- **The `pg_dump` tool on the server**, or `BACKUPS=host` if the host backs the database up itself.

## Settings (`backend/.env` on the server)

| Setting | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the clinic's database |
| `JWT_SECRET` | `openssl rand -hex 32`, never reused |
| `FRONTEND_URL` | the public website address, with `https://`. Every report's QR code points here |
| `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | the clinic's Gmail and its App Password |
| `TRUST_PROXY` | how many proxies sit in front of the server. Default in production is `1`, right for most hosts |
| `BACKUP_PASSPHRASE` | required: backups hold medical records. Keep a copy somewhere safe, away from the server |
| `BACKUP_COPY_DIR` | a second location that is not this server's disk |
| `RATE_LIMIT_MAX` | optional. Requests per 15 minutes per address, default 3,000 |
| `RECORD_AUTO_ARCHIVE` | optional. `off` stops the 10-year archive, leaving it to the Archive button |
| `TURNAROUND_TARGETS` | optional. The clinic's promised turnaround, such as `Laboratory:60,Xray:30,Ultrasound:45` |

The website needs `VITE_API_BASE_URL` and `VITE_GOOGLE_CLIENT_ID` set **before** `npm run build`: they are built in, and
setting them later does nothing. Add the public address to the Google sign-in client's allowed origins.

The server says at start-up what it thinks is missing. Read that log once after the first deploy.

## First deploy

1. Build the database from `database/schema.sql`, then run `node src/scripts/setupRbac.js`.
2. Load the clinic's prices: `node src/scripts/seedRealCatalogue.js --confirm`.
3. Create the real accounts. Never run the demo scripts (`npm run demo`, `seedUsers.js`) on this database.
4. On Super Admin → Payment Methods, publish the clinic's GCash or bank account. Until then online booking stays closed.
5. Try the whole path once with a real email address: sign up, book, pay, check in, release a report, read it.
6. Restore last night's backup into a new database, to prove the backups work. See `BACKUP_AND_RESTORE.md`.

## Updating a live system

Take a backup (`node src/scripts/backupNow.js`), run any new migration scripts listed in `CLAUDE.md` in order, then
restart. Never run `migrateDb.js`: it rebuilds the database from nothing.
