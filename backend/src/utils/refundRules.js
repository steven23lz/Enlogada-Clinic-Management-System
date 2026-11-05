/**
 * What a refund may give back. [1.155.0] Pure, so the arithmetic is tested without a database.
 *
 * A receipt states one amount, and a discount or an HMO's cover means no test on it cost the patient
 * its list price. So each test's share of the money is worked out from the amount actually paid: in
 * proportion to price, across the tests the patient paid for, with the leftover centavos on the largest
 * so the shares add up to the receipt EXACTLY. That is the same rule a package uses to spread its fixed
 * price. Worked out the same way every time, whatever has already been refunded, so a receipt can never
 * give back more than was paid.
 */

const REFUND_KINDS = {
  // The clinic could not do the test: a machine is down, the reagent ran out. That test is cancelled,
  // and the rest of the visit carries on.
  clinic_cannot_perform: 'The clinic cannot perform the test',
  // The receipt should not exist: the wrong patient, the wrong visit, charged twice in effect. The whole
  // receipt goes back and the visit owes again, so the right payment can be taken.
  recorded_by_mistake: 'The payment was recorded by mistake',
};

const toCentavos = (value) => Math.round(Number(value) * 100);

/**
 * @param {Array<{id: number, price: number|string, hmoApproved?: boolean}>} tests  every test on the visit
 * @param {number|string} paidAmount  what the receipt says was paid
 * @returns {Map<number, number>} each test's share in pesos; a test the HMO covered has none
 */
function refundShares(tests, paidAmount) {
  const shares = new Map();
  const paidFor = tests.filter((t) => !t.hmoApproved);
  const totalPrice = paidFor.reduce((sum, t) => sum + toCentavos(t.price), 0);
  const paid = toCentavos(paidAmount);
  tests.forEach((t) => shares.set(t.id, 0));
  if (!paidFor.length || totalPrice <= 0 || paid <= 0) return shares;

  let given = 0;
  let largest = paidFor[0];
  paidFor.forEach((t) => {
    const share = Math.floor((toCentavos(t.price) * paid) / totalPrice);
    shares.set(t.id, share);
    given += share;
    if (toCentavos(t.price) > toCentavos(largest.price)) largest = t;
  });
  shares.set(largest.id, shares.get(largest.id) + (paid - given));
  paidFor.forEach((t) => shares.set(t.id, shares.get(t.id) / 100));
  return shares;
}

/**
 * Why a test cannot be refunded, or null if it can. Its exam done means the clinic did what was paid
 * for, so there is nothing to give back for it: only tests not yet done.
 *
 * @param {{status: string, authorised?: boolean, performed?: boolean, refunded?: boolean, share?: number}} test
 */
function whyNotRefundable(test) {
  if (test.refunded) return 'Already refunded.';
  if (test.status === 'Cancelled') return 'Already cancelled.';
  if (test.authorised || test.status === 'Completed') return 'Its report has been released.';
  if (test.performed || test.status === 'Waiting for Release') return 'Its exam has already been done.';
  if (!(test.share > 0)) return 'The HMO covers it, so the patient paid nothing for it.';
  return null;
}

module.exports = { REFUND_KINDS, refundShares, whyNotRefundable };
