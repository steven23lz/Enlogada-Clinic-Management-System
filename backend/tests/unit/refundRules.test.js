const test = require('node:test');
const assert = require('node:assert/strict');
const { refundShares, whyNotRefundable } = require('../../src/utils/refundRules');

const add = (map) => Math.round([...map.values()].reduce((s, v) => s + v, 0) * 100) / 100;

test('with no discount each test gives back its own price', () => {
  const shares = refundShares([{ id: 1, price: '190.00' }, { id: 2, price: '700.00' }], '890.00');
  assert.equal(shares.get(1), 190);
  assert.equal(shares.get(2), 700);
});

test('a discount comes off each test in proportion, so a refund gives back what was paid', () => {
  const shares = refundShares([{ id: 1, price: 190 }, { id: 2, price: 700 }], 712);
  assert.equal(shares.get(1), 152);
  assert.equal(shares.get(2), 560);
});

test('the shares always add up to the receipt, to the centavo', () => {
  for (const [prices, paid] of [
    [[100, 100, 100], 100],
    [[33.33, 33.33, 33.34], 80],
    [[166.97, 158.18, 166.97, 439.4, 79.09, 439.39], 1160],
    [[0.01, 0.02], 0.02],
  ]) {
    const shares = refundShares(prices.map((price, id) => ({ id, price })), paid);
    assert.equal(add(shares), paid, JSON.stringify(prices));
  }
});

test('a test the HMO covered has no share, and the rest carry the whole payment', () => {
  const shares = refundShares([{ id: 1, price: 190, hmoApproved: true }, { id: 2, price: 700 }], 700);
  assert.equal(shares.get(1), 0);
  assert.equal(shares.get(2), 700);
});

test('nothing paid, nothing to give back', () => {
  const shares = refundShares([{ id: 1, price: 190, hmoApproved: true }], 0);
  assert.equal(shares.get(1), 0);
});

test('only a test not yet done, and paid for, can be refunded', () => {
  assert.equal(whyNotRefundable({ status: 'Pending', share: 100 }), null);
  assert.equal(whyNotRefundable({ status: 'Processing', share: 100 }), null);
  assert.match(whyNotRefundable({ status: 'Completed', share: 100 }), /released/);
  assert.match(whyNotRefundable({ status: 'Processing', authorised: true, share: 100 }), /released/);
  assert.match(whyNotRefundable({ status: 'Waiting for Release', share: 100 }), /done/);
  assert.match(whyNotRefundable({ status: 'Processing', performed: true, share: 100 }), /done/);
  assert.match(whyNotRefundable({ status: 'Processing', share: 0 }), /HMO/);
  assert.match(whyNotRefundable({ status: 'Cancelled', share: 100 }), /cancelled/);
  assert.match(whyNotRefundable({ status: 'Processing', refunded: true, share: 100 }), /refunded/);
});
