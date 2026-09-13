const { ValidationError } = require('../errors');

/**
 * The one shape an ACCOUNT email takes: trimmed and lower-case. [1.73.0]
 *
 * Nothing normalised emails before this, and `findByEmail` matched exactly, so `John@x.com` and
 * `john@x.com` could be two accounts, and a password reset typed with different capitals than the
 * sign-up quietly found nobody — the person was told a code was on its way and none ever came.
 * Every path that creates or looks up an account goes through here now, and users.email carries a
 * UNIQUE index on LOWER(email) (migrateAuthCodes.js), so the two spellings are one account.
 *
 * Patient records keep their own, more permissive rule (patientService.normaliseEmail): a blank
 * address is allowed there, and 255 characters. An account needs an address, and users.email is
 * VARCHAR(150).
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ACCOUNT_EMAIL_LENGTH = 150;

/** For a LOOKUP (sign-in, forgot password): canonical form, no judgement about the shape. */
function canonicalEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

/** For an address about to be stored on an account: canonical, and refused if it cannot be one. */
function normaliseAccountEmail(value) {
  const email = canonicalEmail(value);
  if (!email) throw new ValidationError('Email address is required.');
  if (email.length > MAX_ACCOUNT_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new ValidationError('That email address does not look right. Check it and try again.');
  }
  return email;
}

module.exports = { EMAIL_PATTERN, MAX_ACCOUNT_EMAIL_LENGTH, canonicalEmail, normaliseAccountEmail };
