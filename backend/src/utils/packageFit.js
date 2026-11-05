/**
 * Can a package stay on sale as it now stands? [1.158.0]
 *
 * A package is a fixed price over its tests. Retiring a test takes it out, and lowering a test's price
 * shrinks what the package is measured against, so either can leave a package that costs more than
 * its tests bought separately: Package A at ₱1,450 without HIV Screening (₱500) is ₱1,150 of tests.
 * Nothing should sell that, and nobody should have to notice first, so it goes off sale until someone
 * reprices it. Pure, so it is tested without a database.
 *
 * @param {{ price: number|string, testsLeft: number, listTotal: number|string }} pkg
 * @returns {'too_few'|'dearer_than_tests'|null} why it cannot stay on sale, or null
 */
function whyOffSale({ price, testsLeft, listTotal }) {
  if (testsLeft < 2) return 'too_few';
  if (Number(price) > Number(listTotal)) return 'dearer_than_tests';
  return null;
}

/** What the person who changed the test is told, in one sentence per kind of outcome. */
function describeChanges({ testName, retired, changes }) {
  const sentences = [];
  const names = (list) => list.map((c) => c.name).join(', ');
  if (retired) {
    const kept = changes.filter((c) => !c.offSale);
    if (kept.length) sentences.push(`${testName} came out of ${names(kept)}. Check whether the price still fits.`);
  }
  const off = changes.filter((c) => c.offSale);
  const tooFew = off.filter((c) => c.offSale === 'too_few');
  const dearer = off.filter((c) => c.offSale === 'dearer_than_tests');
  if (dearer.length) {
    sentences.push(`${names(dearer)} now cost${dearer.length === 1 ? 's' : ''} more than ${dearer.length === 1 ? 'its' : 'their'} tests bought separately, so ${dearer.length === 1 ? 'it is' : 'they are'} off sale until repriced.`);
  }
  if (tooFew.length) {
    sentences.push(`${names(tooFew)} now ${tooFew.length === 1 ? 'has' : 'have'} fewer than two tests, so ${tooFew.length === 1 ? 'it is' : 'they are'} off sale.`);
  }
  return sentences.join(' ');
}

module.exports = { whyOffSale, describeChanges };
