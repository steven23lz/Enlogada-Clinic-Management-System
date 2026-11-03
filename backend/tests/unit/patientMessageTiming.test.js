const test = require('node:test');
const assert = require('node:assert/strict');
const { resultsReady, missedBooking, feedbackInvite } = require('../../src/utils/patientMessageTiming');

// The server's own patient emails. [1.148.0] Local parts, as the server reads the clinic's clock.
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute);

test('results ready: sent as soon as the last result is out', () => {
  assert.equal(resultsReady({ completedAt: at(4, 14), now: at(4, 14, 5) }).action, 'send');
});

test('results ready: a release in the evening waits for the morning, not for a day', () => {
  assert.equal(resultsReady({ completedAt: at(4, 20, 50), now: at(4, 22) }).action, 'wait');
  assert.equal(resultsReady({ completedAt: at(4, 20, 50), now: at(5, 7, 1) }).action, 'send');
});

test('results ready: more than a day late is no longer news, and is never sent', () => {
  assert.equal(resultsReady({ completedAt: at(2, 14), now: at(4, 9) }).action, 'skip');
});

test('missed booking: the morning after its day, never on the day itself', () => {
  assert.equal(missedBooking({ scheduledDate: '2026-11-03', now: at(3, 18) }).action, 'wait');
  assert.equal(missedBooking({ scheduledDate: '2026-11-03', now: at(4, 7, 59) }).action, 'wait');
  assert.equal(missedBooking({ scheduledDate: '2026-11-03', now: at(4, 8) }).action, 'send');
});

test('missed booking: a DATE from the database reads the same as its string', () => {
  assert.equal(missedBooking({ scheduledDate: new Date(2026, 10, 3), now: at(4, 9) }).action, 'send');
});

test('missed booking: told within three days, or not at all', () => {
  assert.equal(missedBooking({ scheduledDate: '2026-11-03', now: at(6, 9) }).action, 'send');
  assert.equal(missedBooking({ scheduledDate: '2026-11-03', now: at(8, 9) }).action, 'skip');
});

test('missed booking: not at night', () => {
  const night = missedBooking({ scheduledDate: '2026-11-03', now: at(4, 22) });
  assert.equal(night.action, 'wait');
  assert.equal(night.reason, 'quiet hours');
});

test('feedback: the morning after the visit finished, at 10:00', () => {
  assert.equal(feedbackInvite({ completedAt: at(4, 15), now: at(4, 18) }).action, 'wait');
  assert.equal(feedbackInvite({ completedAt: at(4, 15), now: at(5, 9, 59) }).action, 'wait');
  assert.equal(feedbackInvite({ completedAt: at(4, 15), now: at(5, 10) }).action, 'send');
});

test('feedback: never asked twice, and never once it is answered', () => {
  assert.equal(feedbackInvite({ completedAt: at(4, 15), answered: true, now: at(5, 10) }).action, 'skip');
  assert.equal(feedbackInvite({ completedAt: at(4, 15), now: at(11, 10) }).action, 'skip');
});
