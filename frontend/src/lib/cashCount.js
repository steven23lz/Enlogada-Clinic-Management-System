import { formatCurrency } from './currency';

/**
 * The cash count's arithmetic, for the live total on the form. [1.150.0] The server adds the pieces
 * up again and its answer is the one on the record (backend `utils/cashCount.js`, which
 * tests/unit/cashCount.test.js holds this list to). Worked in centavos: 0.25 × 3 in floating point
 * is how a drawer ends up one centavo short with nothing wrong with it.
 */
export const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.25];

const toCentavos = (value) => Math.round((Number(value) || 0) * 100);
const fromCentavos = (centavos) => Math.round(centavos) / 100;

export const pieceLabel = (value) => `₱${Number(value).toLocaleString('en-PH', {
  minimumFractionDigits: value < 1 ? 2 : 0,
})}`;

/** One pile's worth: 3 of ₱100 is 300. A blank or unreadable pile is worth nothing. */
export const pileValue = (value, count) => fromCentavos(toCentavos(value) * (Math.trunc(Number(count)) || 0));

export function countedTotal(pieces = {}, loose = 0) {
  const centavos = DENOMINATIONS.reduce(
    (sum, value) => sum + toCentavos(value) * (Math.trunc(Number(pieces[value])) || 0),
    toCentavos(loose),
  );
  return fromCentavos(centavos);
}

/** Has anything been entered? A 0 is an answer (an empty drawer); a blank row is not. */
export const hasCount = (pieces = {}, loose = '') =>
  Object.values(pieces).some((v) => v !== '' && v !== null && v !== undefined)
  || (loose !== '' && loose !== null && loose !== undefined);

export const expectedInDrawer = (changeFund, cash) => fromCentavos(toCentavos(changeFund) + toCentavos(cash));

export const differenceOf = (counted, changeFund, cash) =>
  fromCentavos(toCentavos(counted) - toCentavos(changeFund) - toCentavos(cash));

export function outcomeOf(difference) {
  const centavos = toCentavos(difference);
  if (centavos === 0) return 'balanced';
  return centavos < 0 ? 'short' : 'over';
}

/** "It balances", "₱50.00 short", "₱10.00 over". */
export function outcomeWords(difference) {
  const outcome = outcomeOf(difference);
  if (outcome === 'balanced') return 'It balances';
  return `${formatCurrency(Math.abs(Number(difference)))} ${outcome}`;
}

export const OUTCOME_TONE = {
  balanced: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  short: 'border-rose-200 bg-rose-50 text-rose-800',
  over: 'border-amber-200 bg-amber-50 text-amber-800',
};
