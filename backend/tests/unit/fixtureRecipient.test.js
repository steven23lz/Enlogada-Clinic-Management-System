const test = require('node:test');
const assert = require('node:assert/strict');
const { isFixtureRecipient } = require('../../src/utils/fixtureRecipient');

// Which addresses config/email.js never mails. [1.86.0] Both halves matter: a fixture that slips
// through is a send from the clinic's Gmail that can only bounce, and a real address caught by
// mistake is a patient who never gets their result.

test('a throwaway suite account is a fixture, however it is written', () => {
  assert.equal(isFixtureRecipient('lockout_1_2@enlogada-e2e.test'), true);
  assert.equal(isFixtureRecipient('Ana.Reyes.1786@ENLOGADA-E2E.TEST'), true);
  assert.equal(isFixtureRecipient('Ana Reyes <ana.reyes.1786@enlogada-e2e.test>'), true);
  assert.equal(isFixtureRecipient('  client@enlogada.com  '), true);
});

test('the seeded demo accounts are fixtures', () => {
  for (const seeded of ['client@enlogada.com', 'receptionist@enlogada.com', 'multirole@enlogada.com']) {
    assert.equal(isFixtureRecipient(seeded), true, seeded);
  }
});

test('a real address is never caught, including ones that only look alike', () => {
  assert.equal(isFixtureRecipient('enlogada2011@gmail.com'), false);
  assert.equal(isFixtureRecipient('juan@notenlogada.com'), false);
  assert.equal(isFixtureRecipient('juan@enlogada.com.ph'), false);
  assert.equal(isFixtureRecipient('Juan <juan@yahoo.com>'), false);
});

test('a list is never treated as a fixture, so a real recipient in it still gets the mail', () => {
  assert.equal(isFixtureRecipient('juan@gmail.com, client@enlogada.com'), false);
  assert.equal(isFixtureRecipient('client@enlogada.com; juan@gmail.com'), false);
});

test('nothing to send to is not a fixture', () => {
  for (const empty of [undefined, null, '', '   ', 42]) {
    assert.equal(isFixtureRecipient(empty), false, String(empty));
  }
});
