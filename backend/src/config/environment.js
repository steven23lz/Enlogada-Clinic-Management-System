require('dotenv').config();

const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`CRITICAL CONFIG ERROR: Environment variable "${envVar}" is missing.`);
  }
}

module.exports = {
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
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || 'Enlogada Clinic <noreply@enlogadaclinic.com>',
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
