const { test } = require('node:test');
const assert = require('node:assert/strict');
const { whyOffSale, describeChanges } = require('../../src/utils/packageFit');

test('a package under the price of its tests stays on sale, and at exactly that price too', () => {
  assert.equal(whyOffSale({ price: 1450, testsLeft: 6, listTotal: 1650 }), null);
  assert.equal(whyOffSale({ price: '1150.00', testsLeft: 5, listTotal: '1150.00' }), null);
});

test('Package A without HIV Screening costs more than its tests', () => {
  assert.equal(whyOffSale({ price: 1450, testsLeft: 5, listTotal: 1150 }), 'dearer_than_tests');
});

test('fewer than two tests is not a package, whatever the price', () => {
  assert.equal(whyOffSale({ price: 100, testsLeft: 1, listTotal: 500 }), 'too_few');
  assert.equal(whyOffSale({ price: 100, testsLeft: 0, listTotal: 0 }), 'too_few');
});

test('the sentence names each package by what happened to it', () => {
  const said = describeChanges({
    testName: 'HIV Screening',
    retired: true,
    changes: [
      { name: 'Package A', offSale: 'dearer_than_tests' },
      { name: 'Package E', offSale: null },
      { name: 'Package F', offSale: 'too_few' },
    ],
  });
  assert.match(said, /HIV Screening came out of Package E\./);
  assert.match(said, /Package A now costs more than its tests bought separately, so it is off sale/);
  assert.match(said, /Package F now has fewer than two tests/);
});

test('a price change names only what went off sale, and nothing when nothing did', () => {
  assert.equal(describeChanges({ testName: 'CBC', retired: false, changes: [] }), '');
  assert.match(
    describeChanges({ testName: 'CBC', retired: false, changes: [{ name: 'A', offSale: 'dearer_than_tests' }, { name: 'B', offSale: 'dearer_than_tests' }] }),
    /A, B now cost more than their tests bought separately, so they are off sale/
  );
});
