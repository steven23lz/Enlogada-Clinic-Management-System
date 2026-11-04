/**
 * The arithmetic of a cash count. [1.150.0] Pure, tested in `tests/unit/cashCount.test.js`, and the
 * denominations are mirrored in frontend `lib/cashCount.js`, whose test reads this list.
 *
 * Worked in centavos: 0.25 × 3 in floating point is how a drawer ends up one centavo short with
 * nothing wrong with it. The server adds up the pieces itself, so the total on the record is always
 * what the pieces say, never what a browser claimed.
 */

/** The notes and coins a till holds. ₱20 is both a note and a coin, and one pile to count. */
const DENOMINATIONS = Object.freeze([1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.25]);
const MAX_PIECES = 100000;
const MAX_LOOSE = 1000000;

const toCentavos = (value) => Math.round(Number(value) * 100);
const fromCentavos = (centavos) => Math.round(centavos) / 100;

/**
 * Reads what was counted.
 *
 * @param {{pieces?: Object<string, number|string>, loose?: number|string}} input  pieces by
 *   denomination, and `loose`: any other coins as an amount, for a drawer holding 5 or 10 centavos.
 * @returns {{pieces: Object<string, number>, loose: number, total: number}|{error: string}}
 */
function readCount({ pieces = {}, loose } = {}) {
  if (!pieces || typeof pieces !== 'object' || Array.isArray(pieces)) return { error: 'Say how many of each note and coin you counted.' };
  const clean = {};
  let centavos = 0;
  for (const [key, raw] of Object.entries(pieces)) {
    if (!DENOMINATIONS.includes(Number(key))) return { error: `₱${key} is not a note or coin on this form.` };
    if (raw === '' || raw === null || raw === undefined) continue;
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 0 || count > MAX_PIECES) {
      return { error: `The number of ₱${key} must be a whole number, 0 or more.` };
    }
    clean[key] = count;
    centavos += toCentavos(Number(key)) * count;
  }
  const looseGiven = !(loose === '' || loose === null || loose === undefined);
  const looseAmount = looseGiven ? Number(loose) : 0;
  if (!Number.isFinite(looseAmount) || looseAmount < 0 || looseAmount > MAX_LOOSE) {
    return { error: 'Other coins must be an amount, 0 or more.' };
  }
  // Something has to have been entered: nothing typed is not the same as an empty drawer.
  if (Object.keys(clean).length === 0 && !looseGiven) {
    return { error: 'Enter what you counted. If the drawer is empty, enter 0.' };
  }
  centavos += toCentavos(looseAmount);
  return { pieces: clean, loose: fromCentavos(toCentavos(looseAmount)), total: fromCentavos(centavos) };
}

/** A change fund, or null when it is not an amount of 0 or more. */
function readChangeFund(value) {
  if (value === '' || value === null || value === undefined) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= MAX_LOOSE ? fromCentavos(toCentavos(amount)) : null;
}

/** What should be in the drawer: the change fund it started with, and the cash taken. */
const expectedInDrawer = ({ changeFund, cash }) => fromCentavos(toCentavos(changeFund) + toCentavos(cash));

/** Counted minus expected: negative is short, positive is over. */
const differenceOf = ({ counted, changeFund, cash }) =>
  fromCentavos(toCentavos(counted) - toCentavos(changeFund) - toCentavos(cash));

const outcomeOf = (difference) => {
  const centavos = toCentavos(difference);
  if (centavos === 0) return 'balanced';
  return centavos < 0 ? 'short' : 'over';
};

module.exports = { DENOMINATIONS, readCount, readChangeFund, expectedInDrawer, differenceOf, outcomeOf };
