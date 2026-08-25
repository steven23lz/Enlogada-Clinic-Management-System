/**
 * Peso amounts, formatted for something a person reads.
 *
 * The backend writes money into notification text and error messages, and did it as
 * `₱${n.toFixed(2)}` at each site — so a cashier's bell said "₱13690.00". That is legible only if
 * you stop and count the digits, which is the opposite of what a glanceable notification is for,
 * and it disagreed with every figure on screen, all of which come from the frontend's
 * `lib/currency.js` and carry separators.
 *
 * Same locale and same options as that file, deliberately: two formatters that disagree about how
 * the clinic writes money is how "₱1,450.00" and "₱1450.00" end up in one sentence.
 */
const formatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatCurrency(value) {
  const amount = Number(value);
  return formatter.format(Number.isFinite(amount) ? amount : 0);
}

module.exports = { formatCurrency };
