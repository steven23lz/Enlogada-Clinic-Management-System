const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DENOMINATIONS, readCount, readChangeFund, expectedInDrawer, differenceOf, outcomeOf,
} = require('../../src/utils/cashCount');

// The end-of-day cash count. [1.150.0]

test('the pieces add up, in centavos', () => {
  const { total, pieces } = readCount({ pieces: { 1000: 2, 500: 1, 100: 3, 1: 4, 0.25: 3 } });
  assert.equal(total, 2804.75);
  assert.deepEqual(pieces, { 1000: 2, 500: 1, 100: 3, 1: 4, 0.25: 3 });
});

test('0.25 three times is 0.75, not a floating-point near miss', () => {
  assert.equal(readCount({ pieces: { 0.25: 3 } }).total, 0.75);
  assert.equal(differenceOf({ counted: 0.3, changeFund: 0.1, cash: 0.2 }), 0);
});

test('other coins are an amount, for a drawer holding 5 or 10 centavos', () => {
  const { total, loose } = readCount({ pieces: { 100: 1 }, loose: '0.35' });
  assert.equal(total, 100.35);
  assert.equal(loose, 0.35);
});

test('a blank row is not a count, and nothing entered at all is refused', () => {
  assert.deepEqual(readCount({ pieces: { 1000: '', 500: 1 } }).pieces, { 500: 1 });
  assert.match(readCount({ pieces: { 1000: '', 500: null } }).error, /Enter what you counted/);
  assert.match(readCount({}).error, /Enter what you counted/);
});

test('an empty drawer is said with a 0, and that is a count', () => {
  assert.equal(readCount({ pieces: { 1000: 0 } }).total, 0);
  assert.equal(readCount({ pieces: {}, loose: 0 }).total, 0);
});

test('a note that does not exist, a negative pile and half a coin are refused', () => {
  assert.match(readCount({ pieces: { 75: 1 } }).error, /not a note or coin/);
  assert.match(readCount({ pieces: { 100: -1 } }).error, /whole number/);
  assert.match(readCount({ pieces: { 100: 1.5 } }).error, /whole number/);
  assert.match(readCount({ pieces: 'lots' }).error, /how many/);
  assert.match(readCount({ pieces: { 100: 1 }, loose: -1 }).error, /Other coins/);
});

test('the change fund is an amount, and leaving it out is not the same as 0', () => {
  assert.equal(readChangeFund('1000'), 1000);
  assert.equal(readChangeFund(0), 0);
  assert.equal(readChangeFund(''), null);
  assert.equal(readChangeFund(-1), null);
  assert.equal(readChangeFund('some'), null);
});

test('the drawer should hold the change fund and the cash taken', () => {
  assert.equal(expectedInDrawer({ changeFund: 1000, cash: 4250.5 }), 5250.5);
});

test('short is negative, over is positive, and to the centavo is balanced', () => {
  assert.equal(differenceOf({ counted: 5200.5, changeFund: 1000, cash: 4250.5 }), -50);
  assert.equal(outcomeOf(-50), 'short');
  assert.equal(differenceOf({ counted: 5260.5, changeFund: 1000, cash: 4250.5 }), 10);
  assert.equal(outcomeOf(10), 'over');
  assert.equal(outcomeOf(differenceOf({ counted: 5250.5, changeFund: 1000, cash: 4250.5 })), 'balanced');
  assert.equal(outcomeOf('0.00'), 'balanced');
  assert.equal(outcomeOf('-0.01'), 'short');
});

test('the form lists the notes and coins a Philippine till holds, largest first', () => {
  assert.deepEqual([...DENOMINATIONS], [...DENOMINATIONS].sort((a, b) => b - a));
  assert.equal(DENOMINATIONS.includes(1000) && DENOMINATIONS.includes(0.25), true);
});
