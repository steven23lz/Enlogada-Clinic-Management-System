const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  listNames, sharedTests, findOverlap, overlapMessage, onVisitMessage,
} = require('../../src/utils/packageOverlap');

const pkg = (id, name, ...tests) => ({
  id, name, components: tests.map((t) => ({ testId: t, name: `Test ${t}` })),
});

test('names read as a sentence', () => {
  assert.equal(listNames(['CBC']), 'CBC');
  assert.equal(listNames(['CBC', 'FBS']), 'CBC and FBS');
  assert.equal(listNames(['CBC', 'FBS', 'HIV']), 'CBC, FBS and HIV');
});

test('two packages share what is in both, whatever type the ids arrive as', () => {
  assert.deepEqual(sharedTests(pkg(1, 'A', 1, 2, 3), pkg(2, 'B', '2', 3, 4)), ['Test 2', 'Test 3']);
  assert.deepEqual(sharedTests(pkg(1, 'A', 1), pkg(2, 'B', 2)), []);
});

test('packages with nothing in common may go together', () => {
  assert.equal(findOverlap([pkg(1, 'A', 1, 2), pkg(2, 'B', 3, 4), pkg(3, 'C', 5, 6)]), null);
  assert.equal(findOverlap([pkg(1, 'A', 1, 2)]), null);
  assert.equal(findOverlap([]), null);
});

test('any pair sharing a test is found, not only the first two', () => {
  const found = findOverlap([pkg(1, 'A', 1, 2), pkg(2, 'B', 3, 4), pkg(3, 'C', 4, 5)]);
  assert.equal(found.first.name, 'B');
  assert.equal(found.second.name, 'C');
  assert.deepEqual(found.shared, ['Test 4']);
});

test('the refusal names both packages and what they share', () => {
  const overlap = findOverlap([pkg(1, 'Package A', 1, 2), pkg(2, 'Package B', 2)]);
  assert.match(overlapMessage(overlap), /Package A and Package B both include Test 2/);
  assert.match(onVisitMessage(overlap), /already has Package A, and Package B also includes Test 2/);
  assert.match(onVisitMessage(overlap), /Take Package A off first/);
});
