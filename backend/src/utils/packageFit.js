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

/**
 * The note on a package that is off sale. [1.159.0] Steven: it has to say the test is inactive and what
 * to fix before the package shows again. Only for a package something has to be done about: one retired
 * on purpose, with nothing wrong with it and nothing taken out of it, has nothing to say.
 *
 * @param {{ price: number|string, testsLeft: number, listTotal: number|string,
 *   retiredTests?: Array<{ name: string, isActive: boolean }> }} pkg
 * @returns {string|null}
 */
function offSaleNote({ price, testsLeft, listTotal, retiredTests = [] }) {
  const peso = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const list = (items) => items.map((t) => t.name).join(', ');
  const stillOff = retiredTests.filter((t) => !t.isActive);
  const backOn = retiredTests.filter((t) => t.isActive);
  const why = whyOffSale({ price, testsLeft, listTotal });
  if (!why && retiredTests.length === 0) return null;

  const parts = [];
  if (stillOff.length) {
    parts.push(`${list(stillOff)} ${stillOff.length === 1 ? 'is' : 'are'} inactive and came out of this package.`);
  }
  if (backOn.length) {
    const them = backOn.length === 1 ? 'it' : 'them';
    parts.push(`${list(backOn)} came out of this package and ${backOn.length === 1 ? 'is' : 'are'} active again: add ${them} back if the package should include ${them}.`);
  }
  if (why === 'too_few') {
    parts.push(`Patients cannot see it until it is fixed: it has ${testsLeft} test${testsLeft === 1 ? '' : 's'} left and needs at least two. Add tests, then offer it again.`);
  } else if (why === 'dearer_than_tests') {
    parts.push(`Patients cannot see it until it is fixed: it costs ${peso(price)} and its tests now come to ${peso(listTotal)}. Lower the price or add a test, then offer it again.`);
  } else {
    parts.push('Patients cannot see it until it is offered again. It fits as it stands, so it can be.');
  }
  return parts.join(' ');
}

module.exports = { whyOffSale, describeChanges, offSaleNote };
