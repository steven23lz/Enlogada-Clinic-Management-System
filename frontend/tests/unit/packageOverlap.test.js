import { describe, expect, it } from 'vitest';
import { blockedPackages, claimedByPackages } from '../../src/lib/packageOverlap';

const pkg = (id, name, ...tests) => ({ id, name, tests: tests.map((t) => ({ id: t })) });
const A = pkg(1, 'Package A', 10, 11);
const B = pkg(2, 'Package B', 11, 12);
const C = pkg(3, 'Package C', 20, 21);
const packages = [A, B, C];

describe('blockedPackages', () => {
  it('blocks nothing when nothing is chosen', () => {
    expect(blockedPackages({ packages }).size).toBe(0);
  });

  it('blocks a package sharing a test with a chosen one, and names it', () => {
    const blocked = blockedPackages({ packages, selectedPackageIds: ['1'] });
    expect(blocked.get('2')).toEqual({ kind: 'shares', withName: 'Package A' });
    expect(blocked.has('3')).toBe(false);
  });

  it('never blocks a chosen package, so it can be unticked', () => {
    // Both chosen, as an older screen state could hold: each stays free to untick.
    expect(blockedPackages({ packages, selectedPackageIds: ['1', '2'] }).size).toBe(0);
  });

  it('marks a package already on the visit, and one sharing a test with it', () => {
    const onVisit = [
      { package_id: 1, package_name: 'Package A', test_id: 10 },
      { package_id: 1, package_name: 'Package A', test_id: 11 },
    ];
    const blocked = blockedPackages({ packages, onVisit });
    expect(blocked.get('1')).toEqual({ kind: 'on-visit' });
    expect(blocked.get('2')).toEqual({ kind: 'shares', withName: 'Package A' });
    expect(blocked.has('3')).toBe(false);
  });

  it('a loose test on the visit blocks no package: the package takes it over', () => {
    const onVisit = [{ package_id: null, test_id: 11, price_at_time: '180.00' }];
    expect(blockedPackages({ packages, onVisit }).size).toBe(0);
  });
});

describe('claimedByPackages', () => {
  const onVisit = [
    { package_id: null, test_id: 11, price_at_time: '180.00' },
    { package_id: null, test_id: 30, price_at_time: '90.00' },
    { package_id: 3, test_id: 20, price_at_time: '500.00' },
  ];

  it('counts only loose lines inside a chosen package', () => {
    expect(claimedByPackages({ packages, selectedPackageIds: ['1'], onVisit })).toBe(180);
  });

  it('is nothing with no package chosen, or nothing on the visit', () => {
    expect(claimedByPackages({ packages, onVisit })).toBe(0);
    expect(claimedByPackages({ packages, selectedPackageIds: ['1'] })).toBe(0);
  });
});
