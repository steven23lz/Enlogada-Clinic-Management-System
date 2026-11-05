require('dotenv').config();

// The clinic's clock, for Node and for every database session. [1.145.0]
//
// "Today", a booking's hour's notice, an unpaid walk-in's day, a lockout and a hold all read the
// clock, some in JavaScript and some in SQL (CURRENT_DATE, CURRENT_TIMESTAMP into TIMESTAMP
// columns). Both took the HOST's time zone, which on the development PC is UTC+8 and on most
// hosting is UTC. There, "today" would turn over at 08:00 in Bugo, the hour's notice would compare
// UTC hours with the clinic's slot times, and a JavaScript clock read against a stored timestamp
// would be eight hours out. Pinned here, before anything reads a Date; database.js passes the same
// zone to each connection. CLINIC_TIMEZONE overrides it (an IANA name).
const CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || 'Asia/Manila';
try {
  new Intl.DateTimeFormat('en-US', { timeZone: CLINIC_TIMEZONE });
} catch {
  throw new Error(`CRITICAL CONFIG ERROR: CLINIC_TIMEZONE "${CLINIC_TIMEZONE}" is not a time zone. Use an IANA name such as Asia/Manila.`);
}
process.env.TZ = CLINIC_TIMEZONE;

const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`CRITICAL CONFIG ERROR: Environment variable "${envVar}" is missing.`);
  }
}

// The JWT secret is the only thing standing between a stranger and every account in the system.
// Presence alone was the entire check, which is not enough for two reasons.
//
// `.env.example` shipped a working placeholder, and the setup instructions say to base `.env` on
// it — so a deployment that copies the file without editing this line signs tokens with a string
// published in this repository. An attacker signs `{ userId: 1 }` themselves, and because
// authority is now read from the database for whatever userId the token names ([1.11.0]), they
// receive the full role set of user 1: the seeded SuperAdmin.
//
// Short secrets are brute-forceable offline against any captured token, so a length floor matters
// independently of whether the value is a known one.
const WEAK_SECRETS = new Set([
  'supersecretkeyreplaceinproduction',
  'secret',
  'changeme',
  'your_jwt_secret_here'
]);

if (WEAK_SECRETS.has(process.env.JWT_SECRET.trim().toLowerCase())) {
  throw new Error(
    'CRITICAL CONFIG ERROR: JWT_SECRET is still the example value. Anyone with this repository ' +
      'can mint valid tokens for any account. Generate one with: openssl rand -hex 32'
  );
}

if (process.env.JWT_SECRET.length < 32) {
  throw new Error(
    `CRITICAL CONFIG ERROR: JWT_SECRET is ${process.env.JWT_SECRET.length} characters; at least 32 ` +
      'are required. Generate one with: openssl rand -hex 32'
  );
}

module.exports = {
  CLINIC_TIMEZONE,
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  // Shortened from 7d. Roles and permissions are baked into the token at login, so a long-lived
  // token also means a long-lived stale authorization snapshot: revoke a role or deactivate an
  // account and the old token keeps working until it expires, because there is no revocation
  // list. A week of that on a system holding patient records is too generous — 1d covers a
  // working shift without forcing repeated sign-ins. Override with JWT_EXPIRES_IN if needed.
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1d',
  // --- Tax treatment -------------------------------------------------------------------
  // Whether the clinic is VAT-registered with the BIR. This is not cosmetic: it changes what a
  // senior citizen or PWD actually pays.
  //
  // Under RA 9994 and RA 10754 a VAT-registered establishment must treat the sale as VAT-EXEMPT
  // before discounting — strip the 12% VAT from the VAT-inclusive price, then apply the 20% to
  // that VAT-exempt base. A non-VAT establishment simply applies 20% to the price. The two give
  // materially different answers: on a PHP 1,000 service the patient pays 714.29 the correct way
  // and 800.00 the flat way, so getting this wrong overcharges the patient by 85.71 and
  // understates the deduction the clinic can claim.
  //
  // Prices in `tests` are stored VAT-INCLUSIVE (that is the shelf price a patient is quoted), so
  // the VAT is extracted from them rather than added on top.
  //
  // Defaults to true for a VAT-registered establishment, which ENLOGADA IS NOT — its
  // BIR-registered invoice reads "Non VAT Reg. TIN : 412-980-963-00000", so `false` is what
  // belongs in this clinic's .env. The default is left at true only because it is the safer
  // assumption for an unknown deployment: claiming a VAT exemption you are not registered for is
  // worse than not claiming one you are. Getting it wrong costs 85.71 per 1,000 on every senior
  // and PWD sale, and no test catches it — the specs read this value and adapt. — and confirm with your accountant before changing it.
  CLINIC_VAT_REGISTERED: process.env.CLINIC_VAT_REGISTERED !== 'false',

  // A diagnostic result may not be released without its report document. [1.94.0]
  //
  // Default ON: the clinic asked for this, and it is what makes a released result mean something
  // now that findings are no longer typed. Set RESULTS_REQUIRE_FILE=false to restore the previous
  // behaviour without a deploy — this changes how clinical records are stored, and a flag that can
  // be flipped in a minute is worth more than a revert that needs a release.
  //
  // Deliberately gates RELEASE and not recording. A technologist still parks a ticket in
  // 'Waiting for Release' while the report is being produced, which is what that state is for.
  RESULTS_REQUIRE_FILE: process.env.RESULTS_REQUIRE_FILE !== 'false',
  // [1.130.0] The server sends appointment reminders by itself (jobs/reminderScheduler.js). Off with
  // APPOINTMENT_REMINDERS=off, e.g. on a second server sharing one database, which would otherwise
  // sweep too (harmless: each reminder is claimed before it is sent, so it still goes out once).
  APPOINTMENT_REMINDERS: process.env.APPOINTMENT_REMINDERS !== 'off',
  // [1.131.0] Unpaid is temporary: unpaid walk-ins and bookings whose time is up are removed
  // (jobs/unpaidExpiryScheduler.js). Off with UNPAID_EXPIRY=off.
  UNPAID_EXPIRY: process.env.UNPAID_EXPIRY !== 'off',
  // [1.148.0] The server sends three emails by itself: results ready, a missed paid booking, and
  // "how was your visit?" (jobs/patientMessageScheduler.js). Off with PATIENT_EMAILS=off.
  PATIENT_EMAILS: process.env.PATIENT_EMAILS !== 'off',
  // [1.148.0] Old notifications, Activity Log entries and HMO card photos are removed on a schedule
  // (jobs/retentionScheduler.js), as the prune scripts do by hand. Off with RETENTION=off.
  RETENTION: process.env.RETENTION !== 'off',
  // [1.162.0] A record with no activity for 10 years is archived, never deleted. Off with
  // RECORD_AUTO_ARCHIVE=off, which leaves it to the Archive button on Patient Records.
  RECORD_AUTO_ARCHIVE: process.env.RECORD_AUTO_ARCHIVE !== 'off',
  // [1.162.0] Hosted online, the server sits behind a proxy, and without this every patient looks like
  // one address: one person's failed sign-ins would lock out everybody's. How many proxies to trust.
  TRUST_PROXY: process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : (process.env.NODE_ENV === 'production' ? 1 : 0),
  // [1.148.0] A nightly backup of the database and the uploaded files (services/backupService.js,
  // docs/BACKUP_AND_RESTORE.md). Off with BACKUPS=off, which Today warns about; BACKUPS=host says
  // the hosting company backs the database up instead (a managed cloud database), and Today is quiet.
  BACKUPS: !['off', 'host'].includes(process.env.BACKUPS),
  BACKUPS_BY_HOST: process.env.BACKUPS === 'host',
  BACKUP_DIR: process.env.BACKUP_DIR || '',          // default: a folder beside the app, see backupService
  BACKUP_COPY_DIR: process.env.BACKUP_COPY_DIR || '', // a second drive, or a cloud-synced folder
  BACKUP_AT: process.env.BACKUP_AT || '18:00',
  BACKUP_KEEP_DAYS: Math.max(1, parseInt(process.env.BACKUP_KEEP_DAYS || '30', 10) || 30),
  BACKUP_PASSPHRASE: process.env.BACKUP_PASSPHRASE || '', // encrypts every backup file when set
  PG_DUMP_PATH: process.env.PG_DUMP_PATH || '',       // found on its own when blank
  VAT_RATE: parseFloat(process.env.VAT_RATE || '0.12'),

  /**
   * The clinic's own identity, for documents the backend composes on its own — currently the
   * released-result email. [1.61.0]
   *
   * The defaults are the same values frontend/src/lib/clinic.js falls back to, and that is the
   * point: a report emailed to a patient carries the letterhead they read on the website and on
   * their receipt. Three sources drifting apart is a document nobody can rely on, which is the
   * reasoning clinic.js already sets out for the printed receipt.
   *
   * TIN and business permit are deliberately absent. They belong on a BIR document, and a
   * diagnostic report is not one — inventing them onto a clinical email would be worse than the
   * receipt case, where at least the patient might file it for reimbursement.
   */
  CLINIC_NAME: process.env.CLINIC_NAME || 'Enlogada Ultrasound & Diagnostic Clinic',
  CLINIC_ADDRESS: process.env.CLINIC_ADDRESS || 'Bugo, Cagayan de Oro, Philippines 9000',
  CLINIC_PHONE: process.env.CLINIC_PHONE || '0936 132 0650',
  CLINIC_EMAIL: process.env.CLINIC_EMAIL || 'enlogadaclinic2011@gmail.com',

  // Outbound mail. EMAIL_* is accepted as an alias for SMTP_* because that is how Gmail names
  // these when you generate an App Password, and an operator following Google's own wording
  // should not end up with a silently unconfigured mailer. SMTP_* wins where both are set, being
  // the more specific and the one this project has always documented.
  //
  // The password is read from the environment and nowhere else — never a default, never a
  // fallback literal, never logged. `logSafeConfig` below must never gain a line for it.
  SMTP_HOST: process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || process.env.EMAIL_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || process.env.EMAIL_APP_PASSWORD || process.env.EMAIL_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'Enlogada Clinic <noreply@enlogadaclinic.com>',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',

  // --- Online payment gateway (GCash / Maya) --------------------------------------------
  // GCash and Maya do not issue direct merchant API access to applications; in the Philippines
  // you reach them through a BSP-regulated processor. This integration targets PayMongo's
  // hosted Checkout Session, which redirects the payer to GCash's / Maya's own real payment
  // pages and settles back over a signed webhook.
  //
  // Deliberately NOT in requiredEnvVars: with no key configured the gateway reports itself
  // unavailable and the clinic falls back to the cashier-recorded payment path, which is
  // exactly how the system behaved before online payment existed. Nothing breaks when these
  // are blank.
  //
  // PAYMONGO_API_BASE is configurable rather than hardcoded because PayMongo documents this
  // endpoint under both /v1 and /v2; set whichever your account's dashboard shows.
  PAYMONGO_SECRET_KEY: process.env.PAYMONGO_SECRET_KEY || '',
  PAYMONGO_WEBHOOK_SECRET: process.env.PAYMONGO_WEBHOOK_SECRET || '',
  PAYMONGO_API_BASE: process.env.PAYMONGO_API_BASE || 'https://api.paymongo.com/v1'
};
