const test = require('node:test');
const assert = require('node:assert/strict');
const { createPhantomLockout } = require('../../src/utils/phantomLockout');

// [1.173.0] An address with no account is locked as an account is, so a lockout says nothing.
test('locks after the threshold, as a real account does, and unlocks when the time is up', () => {
  let t = 0;
  const lock = createPhantomLockout({ threshold: 3, lockMinutes: 15, now: () => t });
  lock.fail('a@x.com');
  lock.fail('a@x.com');
  assert.equal(lock.lockedMinutes('a@x.com'), 0, 'two failures: not yet');
  lock.fail('a@x.com');
  assert.equal(lock.lockedMinutes('a@x.com'), 15, 'the third sets the lock');
  t += 14 * 60000 + 1;
  assert.equal(lock.lockedMinutes('a@x.com'), 1, 'minutes left round up');
  t += 60000;
  assert.equal(lock.lockedMinutes('a@x.com'), 0, 'and it runs out');
  lock.fail('a@x.com');
  assert.equal(lock.lockedMinutes('a@x.com'), 0, 'a failure after it ran out starts the count again');
});

test('each address counts on its own', () => {
  const lock = createPhantomLockout({ threshold: 2, lockMinutes: 15, now: () => 0 });
  lock.fail('a@x.com'); lock.fail('a@x.com');
  lock.fail('b@x.com');
  assert.equal(lock.lockedMinutes('a@x.com'), 15);
  assert.equal(lock.lockedMinutes('b@x.com'), 0);
});

test('never grows past its cap', () => {
  const lock = createPhantomLockout({ threshold: 99, lockMinutes: 15, now: () => 0 });
  for (let i = 0; i < 10050; i++) lock.fail(`u${i}@x.com`);
  assert.ok(lock.size() <= 10000);
});
