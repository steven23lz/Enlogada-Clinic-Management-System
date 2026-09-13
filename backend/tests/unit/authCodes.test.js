const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateCode,
  generateTicket,
  hashTicket,
  createCodeHasher,
  isWellFormedCode,
  isWellFormedTicket,
} = require('../../src/utils/authCodes');
const { canonicalEmail, normaliseAccountEmail } = require('../../src/validations/email');

// The rules behind the emailed sign-up and reset codes. [1.73.0] Each of these is a property the
// security of the feature rests on, so each is pinned here rather than trusted.

const SECRET = 'a-test-secret-that-is-long-enough-for-the-hasher';

test('a code is always six digits, leading zeros kept', () => {
  for (let i = 0; i < 2000; i += 1) {
    const code = generateCode();
    assert.match(code, /^\d{6}$/);
  }
});

test('codes are spread across the whole range, not bunched at one end', () => {
  // Not a statistics test — a guard against something like `randomInt(100000, 999999)`, which
  // would silently drop every code starting with 0 and a tenth of the space with it.
  const firstDigits = new Set();
  for (let i = 0; i < 3000; i += 1) firstDigits.add(generateCode()[0]);
  assert.equal(firstDigits.size, 10);
});

test('a ticket is 64 hex characters and never repeats', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) {
    const ticket = generateTicket();
    assert.ok(isWellFormedTicket(ticket));
    assert.ok(!seen.has(ticket));
    seen.add(ticket);
  }
});

test('a ticket is stored as its SHA-256, which is not the ticket', () => {
  const ticket = generateTicket();
  const stored = hashTicket(ticket);
  assert.match(stored, /^[0-9a-f]{64}$/);
  assert.notEqual(stored, ticket);
  assert.equal(hashTicket(ticket), stored, 'the same ticket must always find its row');
});

test('a code matches its own hash and nothing else', () => {
  const { hashCode, codeMatches } = createCodeHasher(SECRET);
  const stored = hashCode('042917');
  assert.ok(codeMatches('042917', stored));
  assert.ok(!codeMatches('042918', stored));
  assert.ok(!codeMatches('42917', stored), 'a dropped leading zero is a different code');
});

test('the code hash is keyed: a different server secret gives a different hash', () => {
  // The whole reason for HMAC over a plain hash. A million codes can be tried in a second against
  // an unkeyed hash; without the secret, a copy of the database gives nothing to try them against.
  const a = createCodeHasher(SECRET).hashCode('123456');
  const b = createCodeHasher(`${SECRET}-rotated`).hashCode('123456');
  assert.notEqual(a, b);
  assert.notEqual(a, hashTicket('123456'), 'and it is not the plain SHA-256 either');
});

test('a malformed code or stored hash is refused, never thrown on', () => {
  const { hashCode, codeMatches } = createCodeHasher(SECRET);
  const stored = hashCode('123456');
  for (const bad of ['', '12345', '1234567', 'abcdef', '12 456', null, undefined, 12345]) {
    assert.equal(codeMatches(bad, stored), false, `code ${String(bad)}`);
  }
  assert.equal(codeMatches('123456', 'short'), false);
  assert.equal(codeMatches('123456', null), false);
});

test('the hasher refuses to run without a secret', () => {
  assert.throws(() => createCodeHasher(''), /secret/);
});

test('code and ticket shapes', () => {
  assert.ok(isWellFormedCode('000000'));
  assert.ok(!isWellFormedCode(' 123456'));
  assert.ok(!isWellFormedTicket('A'.repeat(64)), 'upper-case hex is not what generateTicket makes');
  assert.ok(!isWellFormedTicket('a'.repeat(63)));
});

test('an account email is trimmed and lower-cased, so the capitals never make a second account', () => {
  assert.equal(normaliseAccountEmail('  Juan.DelaCruz@Gmail.COM '), 'juan.delacruz@gmail.com');
  assert.equal(canonicalEmail(' Juan@X.com'), 'juan@x.com');
});

test('an address that cannot be one is refused with a 400', () => {
  for (const bad of ['', '   ', 'juan', 'juan@', '@x.com', 'juan@x', 'ju an@x.com', `${'a'.repeat(145)}@x.com`]) {
    assert.throws(() => normaliseAccountEmail(bad), (err) => err.statusCode === 400, bad);
  }
});

test('a lookup never refuses, it only canonicalises', () => {
  assert.equal(canonicalEmail(undefined), '');
  assert.equal(canonicalEmail('not an email'), 'not an email');
});
