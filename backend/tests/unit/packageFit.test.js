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

test('the note on a package off sale names the test and what to fix', () => {
  const { offSaleNote } = require('../../src/utils/packageFit');
  const hiv = { name: 'HIV Screening', isActive: false };
  const dearer = offSaleNote({ price: 1450, testsLeft: 5, listTotal: 1150, retiredTests: [hiv] });
  assert.match(dearer, /HIV Screening is inactive and came out of this package/);
  assert.match(dearer, /costs ₱1,450\.00 and its tests now come to ₱1,150\.00/);
  assert.match(offSaleNote({ price: 500, testsLeft: 1, listTotal: 300, retiredTests: [hiv] }), /1 test left and needs at least two/);
  assert.match(offSaleNote({ price: 900, testsLeft: 5, listTotal: 1150, retiredTests: [hiv] }), /fits as it stands/);
  assert.match(offSaleNote({ price: 900, testsLeft: 5, listTotal: 1150, retiredTests: [{ name: 'CBC', isActive: true }] }), /CBC came out of this package and is active again/);
});

test('a package retired on purpose, with nothing wrong and nothing taken out, has no note', () => {
  const { offSaleNote } = require('../../src/utils/packageFit');
  assert.equal(offSaleNote({ price: 900, testsLeft: 5, listTotal: 1150 }), null);
});

test('a price falling with no test taken out still says what to fix', () => {
  const { offSaleNote } = require('../../src/utils/packageFit');
  assert.match(offSaleNote({ price: 900, testsLeft: 2, listTotal: 600 }), /Lower the price or add a test/);
});
