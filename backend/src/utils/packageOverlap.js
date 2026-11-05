/**
 * Two packages that share a test cannot both be on a visit. [1.157.0]
 *
 * A package is sold at one fixed price, spread across its tests, and a test can only be on a visit
 * once (uq_visit_tests_visit_test). So when two bundles shared a test the first kept it and the
 * second was silently cut down to whatever was left, at the share of its price those few tests
 * happened to carry. All five of the clinic's packages hold the same six tests: ticking all five
 * quoted ₱9,490 and billed ₱3,214.40, and A + B billed ₱1,887.18 for everything in Package B, which
 * costs ₱1,940 by itself. Taking the first one off then left "Package B" as two tests for ₱437.18.
 *
 * Pure, so the rule is tested without a database. The same rule is in frontend/src/lib/packageOverlap.js.
 */

/** "A", "A and B", "A, B and C". */
const listNames = (names) => {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/** The tests two packages have in common. Each package: { components: [{ testId, name }] }. */
const sharedTests = (first, second) => {
  const inSecond = new Set(second.components.map((c) => Number(c.testId)));
  return first.components.filter((c) => inSecond.has(Number(c.testId))).map((c) => c.name);
};

/** The first pair in the list that shares a test, or null. */
const findOverlap = (packages) => {
  for (let i = 0; i < packages.length; i += 1) {
    for (let j = i + 1; j < packages.length; j += 1) {
      const shared = sharedTests(packages[i], packages[j]);
      if (shared.length > 0) return { first: packages[i], second: packages[j], shared };
    }
  }
  return null;
};

/** Why two packages chosen together are refused. */
const overlapMessage = ({ first, second, shared }) => (
  `${first.name} and ${second.name} both include ${listNames(shared)}. A package is one fixed price, so a test cannot be sold under two of them. Choose one package, and add any other test on its own.`
);

/** Why a package is refused on a visit already carrying another. */
const onVisitMessage = ({ first, second, shared }) => (
  `This visit already has ${first.name}, and ${second.name} also includes ${listNames(shared)}. A package is one fixed price, so a test cannot be sold under two of them. Take ${first.name} off first, or add the other tests on their own.`
);

module.exports = { listNames, sharedTests, findOverlap, overlapMessage, onVisitMessage };
