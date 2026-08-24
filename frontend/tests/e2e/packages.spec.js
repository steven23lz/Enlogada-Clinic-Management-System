// @ts-check
import { test, expect, request } from 'playwright/test';

/**
 * The clinic's package deals. [1.45.0]
 *
 * A package is a fixed-price bundle that DECOMPOSES into ordinary tests, because a `tests` row has
 * one `category_id` and that is what routes work to a department worklist — every one of these
 * bundles spans Laboratory and Ultrasound at once, so as a single row half the work would never
 * reach the department that has to do it.
 *
 * What that buys, and what therefore has to be guarded:
 *
 *  * The components must sum to the package price EXACTLY. `visit_tests.price_at_time` is what
 *    every downstream total reads — the visit subtotal, the statutory discount base, the
 *    cashier's drawer, the per-department revenue report. A split that does not reconcile is a
 *    patient charged the wrong amount, and it would go unnoticed because each individual line
 *    looks plausible on its own.
 *  * Each component must land in its own department, which is the entire reason for expanding
 *    rather than storing one row.
 *  * A package must never be billed as the sum of its parts, which is what happened before this
 *    existed: reception added the components one at a time and the patient paid list price.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const CASHIER = { email: 'cashier@enlogada.com', password: 'Password123!' };

const uniqueName = (prefix) => `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`;

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

/** A throwaway walk-in to attach things to. */
async function makeWalkIn(api, token) {
  const H = { Authorization: `Bearer ${token}` };

  const typesRes = await api.get(`${API}/patients/types`, { headers: H });
  const selfPay = (await typesRes.json()).data.patientTypes.find((t) => t.name === 'Self Pay');

  const patientRes = await api.post(`${API}/patients`, {
    headers: H,
    data: {
      firstName: 'E2E', lastName: uniqueName('Pkg'), birthdate: '1990-01-01', sex: 'Female',
      address: 'E2E', contactNumber: '09170000000', patientTypeId: selfPay.id,
    },
  });
  const patient = (await patientRes.json()).data.patient;

  const visitRes = await api.post(`${API}/visits`, {
    headers: H,
    data: { patientId: patient.id, visitType: 'Walk in', notes: 'e2e package' },
  });
  return (await visitRes.json()).data.visit;
}

test.describe('Package deals', () => {
  test('the public price list offers them, with their components', async () => {
    // No auth: a prospective patient reads this page before they have an account, and a bundle
    // they cannot see is a bundle they cannot ask for.
    const api = await request.newContext();
    const res = await api.get(`${API}/packages`);
    expect(res.ok()).toBeTruthy();

    const { packages } = (await res.json()).data;
    expect(packages.length).toBeGreaterThan(0);

    for (const pkg of packages) {
      expect(Number(pkg.price), `${pkg.name} has no price`).toBeGreaterThan(0);
      expect(pkg.tests.length, `${pkg.name} has no components`).toBeGreaterThan(1);
      // The point of a package is that it crosses departments. If one ever stopped doing that it
      // could be a plain test, and the expansion machinery would be dead weight.
      const departments = new Set(pkg.tests.map((t) => t.categoryName));
      expect(departments.size, `${pkg.name} is confined to one department`).toBeGreaterThan(1);
    }
    await api.dispose();
  });

  test('booking one expands into its components and bills exactly the package price', async () => {
    const api = await request.newContext();
    const token = await loginAs(api, RECEPTIONIST);
    const H = { Authorization: `Bearer ${token}` };

    const { packages } = (await (await api.get(`${API}/packages`)).json()).data;
    const pkg = packages[0];
    const visit = await makeWalkIn(api, token);

    const attachRes = await api.post(`${API}/tests/visit-tests`, {
      headers: H,
      data: { patientVisitId: visit.id, packageIds: [pkg.id] },
    });
    expect(attachRes.status()).toBe(201);

    const { visitTests } = (await attachRes.json()).data;

    // Every component present, and every one stamped with the package it came from.
    expect(visitTests.length).toBe(pkg.tests.length);
    for (const vt of visitTests) {
      expect(vt.package_code, `${vt.test_name} lost its package`).toBe(pkg.code);
    }

    // The whole reason for the allocation: the parts must reconcile to the whole, to the centavo.
    const sum = visitTests.reduce((acc, vt) => acc + Number(vt.price_at_time), 0);
    expect(sum.toFixed(2)).toBe(Number(pkg.price).toFixed(2));

    // And no component may be negative — a rounding remainder placed carelessly could do that,
    // and `chk_visit_tests_price` would only catch it below zero.
    for (const vt of visitTests) {
      expect(Number(vt.price_at_time)).toBeGreaterThanOrEqual(0);
    }

    await api.dispose();
  });

  test('the cashier is asked for the package price, not the sum of the parts', async () => {
    const api = await request.newContext();
    const recToken = await loginAs(api, RECEPTIONIST);
    const cashToken = await loginAs(api, CASHIER);

    const { packages } = (await (await api.get(`${API}/packages`)).json()).data;
    const pkg = packages[0];
    const visit = await makeWalkIn(api, recToken);

    await api.post(`${API}/tests/visit-tests`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientVisitId: visit.id, packageIds: [pkg.id] },
    });

    const billRes = await api.get(`${API}/payments/bill/${visit.id}`, {
      headers: { Authorization: `Bearer ${cashToken}` },
    });
    const { bill } = (await billRes.json()).data;

    expect(Number(bill.subtotal).toFixed(2)).toBe(Number(pkg.price).toFixed(2));
    expect(Number(bill.totalAmount).toFixed(2)).toBe(Number(pkg.price).toFixed(2));

    // What the components would have cost bought individually. This is the number the patient
    // used to be charged, and a bundle must come in under it — otherwise it is a surcharge
    // wearing the word "package".
    //
    // Only assertable when every component actually HAS a price. HIV Screening is currently
    // loaded at 0.00 because no sheet gives it a standalone figure, and comparing against a list
    // total that is missing a real component would be comparing against a number the clinic never
    // quoted. The moment HIV is priced this becomes live for all five packages — and it should,
    // because it is the check that catches a bundle that has stopped being a discount.
    const unpriced = pkg.tests.filter((t) => Number(t.price) === 0);
    if (unpriced.length === 0) {
      const listTotal = pkg.tests.reduce((acc, t) => acc + Number(t.price), 0);
      expect(Number(bill.totalAmount)).toBeLessThanOrEqual(listTotal);
    } else {
      // Not silent about skipping: a check that quietly does not run reads exactly like one that
      // passed, which is how three security tests went missing for a week.
      console.warn(
        `[packages] saving check skipped for ${pkg.name}: ` +
        `${unpriced.map((t) => t.name).join(', ')} has no list price yet`
      );
    }

    // The bill carries the grouping, so the terminal and the receipt can say "Package A" once
    // rather than listing components at prices that look arbitrary on their own.
    expect(bill.items.every((i) => i.packageCode === pkg.code)).toBeTruthy();

    await api.dispose();
  });

  test('a component reaches its own department, which is why it is expanded at all', async () => {
    const api = await request.newContext();
    const token = await loginAs(api, RECEPTIONIST);
    const H = { Authorization: `Bearer ${token}` };

    const { packages } = (await (await api.get(`${API}/packages`)).json()).data;
    const pkg = packages[0];
    const visit = await makeWalkIn(api, token);

    await api.post(`${API}/tests/visit-tests`, {
      headers: H,
      data: { patientVisitId: visit.id, packageIds: [pkg.id] },
    });

    const listRes = await api.get(`${API}/tests/visit-tests/${visit.id}`, { headers: H });
    const rows = (await listRes.json()).data.visitTests;

    const departments = new Set(rows.map((r) => r.category_name));
    expect(departments.size).toBeGreaterThan(1);

    // Named explicitly rather than just counted: the bundle is worthless if the ultrasound half
    // never reaches Ultrasound, and "more than one department" would still pass if it landed in
    // two wrong ones.
    for (const t of pkg.tests) {
      const row = rows.find((r) => r.test_name === t.name);
      expect(row, `${t.name} never reached a worklist`).toBeTruthy();
      expect(row.category_name).toBe(t.categoryName);
    }

    await api.dispose();
  });

  test('a bad package id is refused, and nothing is half-attached', async () => {
    const api = await request.newContext();
    const token = await loginAs(api, RECEPTIONIST);
    const H = { Authorization: `Bearer ${token}` };
    const visit = await makeWalkIn(api, token);

    const res = await api.post(`${API}/tests/visit-tests`, {
      headers: H,
      data: { patientVisitId: visit.id, packageIds: [99999999] },
    });
    expect(res.status()).toBe(404);

    // The whole attach runs in one transaction, so a rejected id must leave the visit untouched
    // rather than billed for whatever happened to resolve before the bad one.
    const listRes = await api.get(`${API}/tests/visit-tests/${visit.id}`, { headers: H });
    expect((await listRes.json()).data.visitTests.length).toBe(0);

    await api.dispose();
  });
});
