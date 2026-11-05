const { test } = require('node:test');
const assert = require('node:assert/strict');
const { closingWindow } = require('../../src/utils/closingNotice');

const at = (h, m = 0) => h * 60 + m;
const weekday = { isOpen: true, closeMinutes: at(17) };

test('before 4:45 PM on a day closing at 5:00 PM, nothing yet', () => {
  assert.deepEqual(closingWindow(weekday, at(16, 44)), { inWindow: false, closesAt: null });
});

test('from 4:45 PM until closing, the last call', () => {
  assert.deepEqual(closingWindow(weekday, at(16, 45)), { inWindow: true, closesAt: '17:00' });
  assert.deepEqual(closingWindow(weekday, at(16, 59)), { inWindow: true, closesAt: '17:00' });
});

test('once closed, the window is over', () => {
  assert.equal(closingWindow(weekday, at(17)).inWindow, false);
  assert.equal(closingWindow(weekday, at(22)).inWindow, false);
});

test("a Saturday's last call follows its own closing time", () => {
  const saturday = { isOpen: true, closeMinutes: at(12) };
  assert.deepEqual(closingWindow(saturday, at(11, 45)), { inWindow: true, closesAt: '12:00' });
  assert.equal(closingWindow(saturday, at(16, 50)).inWindow, false);
});

test('a closed day has none', () => {
  assert.equal(closingWindow({ isOpen: false }, at(16, 50)).inWindow, false);
  assert.equal(closingWindow(null, at(16, 50)).inWindow, false);
});
