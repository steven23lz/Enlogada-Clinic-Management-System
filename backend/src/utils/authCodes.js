const crypto = require('crypto');

/**
 * The 6-digit codes emailed at sign-up and for a password reset, and the tickets that go with
 * them. [1.73.0] Pure functions only — no database, no environment — so every rule here is
 * unit-tested (tests/unit/authCodes.test.js).
 *
 * ── Two secrets, held in two places ─────────────────────────────────────────────────────────
 *
 * A request starts by handing the browser a TICKET (32 random bytes) and emailing a CODE (6
 * digits). Finishing needs both. The code alone is useless without the ticket, and a code sent for
 * somebody else's attempt cannot finish yours: if a stranger starts a sign-up with your address,
 * the code in your inbox belongs to THEIR ticket, and entering it in your own browser does nothing.
 *
 * ── How each is stored ──────────────────────────────────────────────────────────────────────
 *
 * The ticket is 256 bits of randomness, so a plain SHA-256 of it is enough — nobody can guess
 * one back from its hash. The code is only a million possibilities, so a plain hash of it could
 * be reversed by trying them all in a second. It is HMAC'd instead, with a key derived from
 * JWT_SECRET: someone holding a copy of the database but not the server's secret learns nothing.
 * The derivation label keeps that key distinct from the one that signs sessions.
 */

const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 10;
/** Wrong guesses allowed per code, the right one included. 5 in a million is the odds of a guess. */
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
/** The first code and three more. Past that, the person starts again. */
const MAX_SENDS_PER_TICKET = 4;
/** Codes issued to one address per hour, however many tickets ask. Stops one inbox being flooded. */
const MAX_CODES_PER_EMAIL_PER_HOUR = 5;

const CODE_PATTERN = /^\d{6}$/;
const TICKET_PATTERN = /^[0-9a-f]{64}$/;

/** Uniform over 000000–999999. `randomInt` has no modulo bias; `Math.random` would not do. */
function generateCode() {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

function generateTicket() {
  return crypto.randomBytes(32).toString('hex');
}

function hashTicket(ticket) {
  return crypto.createHash('sha256').update(String(ticket)).digest('hex');
}

/**
 * @param {string} secret  The server's JWT_SECRET.
 * @returns {{ hashCode: (code: string) => string, codeMatches: (code: string, storedHash: string) => boolean }}
 */
function createCodeHasher(secret) {
  if (!secret) throw new Error('createCodeHasher needs the server secret.');
  const key = crypto.createHmac('sha256', String(secret)).update('enlogada:auth-code:v1').digest();

  const hashCode = (code) => crypto.createHmac('sha256', key).update(String(code)).digest('hex');

  // Constant-time, so how long a wrong guess takes to refuse says nothing about how close it was.
  const codeMatches = (code, storedHash) => {
    if (!isWellFormedCode(code) || typeof storedHash !== 'string' || storedHash.length !== 64) return false;
    return crypto.timingSafeEqual(Buffer.from(hashCode(code), 'hex'), Buffer.from(storedHash, 'hex'));
  };

  return { hashCode, codeMatches };
}

const isWellFormedCode = (code) => CODE_PATTERN.test(String(code ?? ''));
const isWellFormedTicket = (ticket) => TICKET_PATTERN.test(String(ticket ?? ''));

module.exports = {
  CODE_LENGTH,
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  MAX_SENDS_PER_TICKET,
  MAX_CODES_PER_EMAIL_PER_HOUR,
  generateCode,
  generateTicket,
  hashTicket,
  createCodeHasher,
  isWellFormedCode,
  isWellFormedTicket,
};
