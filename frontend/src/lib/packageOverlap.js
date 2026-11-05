/**
 * Which packages can no longer be chosen, and why. [1.157.0]
 *
 * A package is one fixed price, so two that share a test cannot both be on a visit; the server refuses
 * it (backend/src/utils/packageOverlap.js). All five of the clinic's packages hold the same six tests,
 * and ticking them all quoted ₱9,490 for a bill of ₱3,214.40. Said here so the patient and the desk see
 * it at the tick rather than as a refusal after the form.
 *
 * `onVisit` is what the visit already carries, when tests are being added to one.
 */

const sharesATest = (first, second) => {
  const ids = new Set((first || []).map(Number));
  return (second || []).some((id) => ids.has(Number(id)));
};

/** Each package on the visit: { id, name, testIds }. */
const packagesOnVisit = (onVisit) => {
  const byId = new Map();
  for (const line of onVisit || []) {
    if (!line.package_id) continue;
    if (!byId.has(line.package_id)) {
      byId.set(line.package_id, { id: line.package_id, name: line.package_name, testIds: [] });
    }
    byId.get(line.package_id).testIds.push(line.test_id);
  }
  return [...byId.values()];
};

/**
 * @returns {Map<string, { kind: 'on-visit' } | { kind: 'shares', withName: string }>} keyed by package
 *   id. A package already ticked is never blocked, so it can always be unticked.
 */
export function blockedPackages({ packages = [], selectedPackageIds = [], onVisit = [] }) {
  const blocked = new Map();
  const carried = packagesOnVisit(onVisit);
  const testIdsOf = (p) => (p.tests || []).map((t) => t.id);
  const chosen = packages.filter((p) => selectedPackageIds.includes(p.id.toString()));

  for (const p of packages) {
    const id = p.id.toString();
    if (selectedPackageIds.includes(id)) continue;
    if (carried.some((c) => Number(c.id) === Number(p.id))) {
      blocked.set(id, { kind: 'on-visit' });
      continue;
    }
    const clash = carried.find((c) => sharesATest(c.testIds, testIdsOf(p)))
      || chosen.find((c) => sharesATest(testIdsOf(c), testIdsOf(p)));
    if (clash) blocked.set(id, { kind: 'shares', withName: clash.name });
  }
  return blocked;
}

/**
 * What adding these packages really adds to a bill. A package takes over a test the visit already
 * has on its own (testRepository.addTestToVisit), so that test's own price stops being charged.
 *
 * @returns {number} the prices of the loose lines the chosen packages would take over.
 */
export function claimedByPackages({ packages = [], selectedPackageIds = [], onVisit = [] }) {
  const inChosen = new Set();
  for (const p of packages) {
    if (!selectedPackageIds.includes(p.id.toString())) continue;
    for (const t of p.tests || []) inChosen.add(Number(t.id));
  }
  return (onVisit || [])
    .filter((line) => !line.package_id && inChosen.has(Number(line.test_id)))
    .reduce((sum, line) => sum + Number(line.price_at_time || 0), 0);
}
