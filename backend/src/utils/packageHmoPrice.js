/**
 * What a package's tests cost once an HMO has answered. [1.159.0]
 *
 * Steven's rule: a package price is for the package. When an HMO covers only part of it, the deal is
 * off, and EVERY test in it goes back to its own price, covered or not. So Package A (₱1,450, six tests
 * worth ₱1,650) with only HIV Screening approved is ₱500 to the HMO and ₱1,150 to the patient.
 *
 * Only a real split ends it: nothing approved, or everything approved, keeps the package price. And it
 * is worked out from where the decisions stand now, never from the last change, so a second claim
 * approving the rest puts the package price back.
 *
 * Pure, so it is tested without a database.
 *
 * @param {Array<{ id: number, packageId: number, packageName?: string, price: number|string,
 *   share: number|string|null, listPrice: number|string|null, hmoStatus: string|null }>} lines
 *   one visit's package lines; a line with no decision has a null hmoStatus
 * @returns {Array<{ packageId: number, name: string, atOwnPrice: boolean, before: number, after: number,
 *   packagePrice: number, ownPriceTotal: number, changes: Array<{ id: number, price: number }> }>}
 */
function pricePackages(lines) {
  const byPackage = new Map();
  for (const line of lines) {
    if (!byPackage.has(line.packageId)) byPackage.set(line.packageId, []);
    byPackage.get(line.packageId).push(line);
  }

  const centavos = (n) => Math.round(Number(n) * 100);
  const pesos = (list) => list.reduce((sum, n) => sum + centavos(n), 0) / 100;

  return [...byPackage.entries()].map(([packageId, group]) => {
    const covered = group.filter((l) => l.hmoStatus === 'Approved').length;
    const atOwnPrice = covered > 0 && covered < group.length;
    const shareOf = (l) => l.share ?? l.price;
    const ownOf = (l) => l.listPrice ?? l.price;
    const target = (l) => Number(atOwnPrice ? ownOf(l) : shareOf(l));

    return {
      packageId,
      name: group[0].packageName || 'This package',
      atOwnPrice,
      before: pesos(group.map((l) => l.price)),
      after: pesos(group.map(target)),
      packagePrice: pesos(group.map(shareOf)),
      ownPriceTotal: pesos(group.map(ownOf)),
      changes: group
        .filter((l) => centavos(l.price) !== centavos(target(l)))
        .map((l) => ({ id: l.id, price: target(l) })),
    };
  });
}

/**
 * The packages on a bill that are at their tests' own prices, read from what is stored: a paid visit's
 * prices are final, whatever a decision says afterwards.
 *
 * @param {Array<{ packageId: number|null, packageName?: string, price: number|string,
 *   share: number|string|null, listPrice: number|string|null }>} lines
 * @returns {Array<{ name: string, packagePrice: number, ownPriceTotal: number }>}
 */
function packagesAtOwnPrice(lines) {
  const onPackage = lines.filter((l) => l.packageId);
  const ids = [...new Set(onPackage.map((l) => l.packageId))];
  const centavos = (n) => Math.round(Number(n) * 100);
  const out = [];
  for (const id of ids) {
    const group = onPackage.filter((l) => l.packageId === id);
    if (!group.some((l) => l.share != null && centavos(l.price) !== centavos(l.share))) continue;
    const sum = (read) => group.reduce((total, l) => total + centavos(read(l)), 0) / 100;
    out.push({
      packageId: id,
      name: group[0].packageName || 'This package',
      packagePrice: sum((l) => l.share ?? l.price),
      ownPriceTotal: sum((l) => l.price),
    });
  }
  return out;
}

module.exports = { pricePackages, packagesAtOwnPrice };
