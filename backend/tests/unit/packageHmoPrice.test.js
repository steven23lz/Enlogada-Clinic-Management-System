const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pricePackages, packagesAtOwnPrice } = require('../../src/utils/packageHmoPrice');

// Package A as it stands: ₱1,450 over six tests worth ₱1,650.
const LIST = [500, 180, 190, 190, 90, 500];
const SHARES = [439.39, 158.18, 166.97, 166.97, 79.09, 439.40];
const packageA = (statuses = [], prices = SHARES) => LIST.map((listPrice, i) => ({
  id: i + 1,
  packageId: 7,
  packageName: 'Package A',
  price: prices[i],
  share: SHARES[i],
  listPrice,
  hmoStatus: statuses[i] ?? null,
}));

test('no HMO decision: the package price stands and nothing changes', () => {
  const [a] = pricePackages(packageA());
  assert.equal(a.atOwnPrice, false);
  assert.equal(a.after, 1450);
  assert.deepEqual(a.changes, []);
});

test('one test covered: every test goes back to its own price', () => {
  const [a] = pricePackages(packageA(['Approved']));
  assert.equal(a.atOwnPrice, true);
  assert.equal(a.before, 1450);
  assert.equal(a.after, 1650);
  assert.deepEqual(a.changes.map((c) => c.price), LIST);
});

test('some covered and some refused is still a split', () => {
  const [a] = pricePackages(packageA(['Approved', 'Rejected', 'Approved', 'Rejected', 'Approved', 'Rejected']));
  assert.equal(a.atOwnPrice, true);
  assert.equal(a.after, 1650);
});

test('some covered and some still waiting reads as a split until the rest is answered', () => {
  const [a] = pricePackages(packageA(['Approved', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending']));
  assert.equal(a.atOwnPrice, true);
});

test('all of it covered: the HMO pays the package price', () => {
  const [a] = pricePackages(packageA(Array(6).fill('Approved')));
  assert.equal(a.atOwnPrice, false);
  assert.equal(a.after, 1450);
});

test('all of it refused, or only waiting: the patient pays the package price', () => {
  assert.equal(pricePackages(packageA(Array(6).fill('Rejected')))[0].after, 1450);
  assert.equal(pricePackages(packageA(Array(6).fill('Pending')))[0].after, 1450);
});

test('the rest approved afterwards puts the package price back', () => {
  const [a] = pricePackages(packageA(Array(6).fill('Approved'), LIST));
  assert.equal(a.atOwnPrice, false);
  assert.equal(a.before, 1650);
  assert.equal(a.after, 1450);
  assert.deepEqual(a.changes.map((c) => c.price), SHARES);
});

test('two packages on a visit are judged apart', () => {
  const other = [{ id: 20, packageId: 8, packageName: 'Package X', price: 100, share: 100, listPrice: 150, hmoStatus: null },
    { id: 21, packageId: 8, packageName: 'Package X', price: 100, share: 100, listPrice: 150, hmoStatus: null }];
  const result = pricePackages([...packageA(['Approved']), ...other]);
  assert.equal(result.find((p) => p.packageId === 7).atOwnPrice, true);
  assert.equal(result.find((p) => p.packageId === 8).atOwnPrice, false);
});

test('a line from before the columns existed keeps the price it has', () => {
  const [a] = pricePackages([
    { id: 1, packageId: 7, price: 100, share: null, listPrice: null, hmoStatus: 'Approved' },
    { id: 2, packageId: 7, price: 200, share: null, listPrice: null, hmoStatus: null },
  ]);
  assert.deepEqual(a.changes, []);
});

test('a bill says which packages are at own prices, from the prices it holds', () => {
  const lines = (prices) => packageA([], prices).map((l) => ({ ...l }));
  assert.deepEqual(packagesAtOwnPrice(lines(SHARES)), []);
  const [a] = packagesAtOwnPrice(lines(LIST));
  assert.equal(a.name, 'Package A');
  assert.equal(a.packagePrice, 1450);
  assert.equal(a.ownPriceTotal, 1650);
});

test('a loose test and a line with no share are never called a package at own price', () => {
  assert.deepEqual(packagesAtOwnPrice([{ packageId: null, price: 100, share: null }]), []);
  assert.deepEqual(packagesAtOwnPrice([{ packageId: 7, price: 100, share: null }]), []);
});
