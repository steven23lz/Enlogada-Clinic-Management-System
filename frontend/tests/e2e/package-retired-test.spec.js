// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { patientTypeId } from './helpers/patients.js';
import { API, CREDS, loginAs } from './helpers/payments.js';

/**
 * A retired test is out of its packages. [1.158.0]
 *
 * Steven: "of course it should be out of the package if it is inactive". It stayed in, so a package
 * kept selling a test the clinic had stopped doing. And taking it out has a money side: Package A at
 * ₱1,450 without HIV Screening (₱500) is ₱1,150 of tests, so what no longer fits goes off sale.
 *
 * Throwaway tests and packages only: the clinic's real ones are never touched here.
 */

const auth = (t) => ({ Authorization: `Bearer ${t}` });
let run = 0;

test.describe('A retired test is out of its packages [1.158.0]', () => {
  let ctx;
  let su;
  let desk;
  let categoryId;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    su = await loginAs(ctx, CREDS.superadmin);
    desk = await loginAs(ctx, CREDS.receptionist);
    const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
    categoryId = tests.find((t) => t.category_name === 'Laboratory').category_id;
  });
  // Off sale before anything else runs: packages.spec.js holds every package on offer to crossing
  // departments, and booking screens list them.
  const made = [];
  test.afterEach(async () => {
    for (const id of made.splice(0)) {
      await ctx.patch(`${API}/packages/${id}`, { headers: auth(su), data: { isActive: false } });
    }
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  const stamp = () => `${Date.now() % 1000000}${(run += 1)}`;

  async function makeTest(price, label = 'Test') {
    const res = await ctx.post(`${API}/tests`, {
      headers: auth(su), data: { categoryId, name: `E2E Retire ${label} ${stamp()}`, price },
    });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).data.test;
  }
  async function makePackage(price, tests) {
    const res = await ctx.post(`${API}/packages`, {
      headers: auth(su),
      data: { code: `RT${stamp()}`.slice(0, 12), name: `E2E Retire Bundle ${stamp()}`, price, testIds: tests.map((t) => t.id) },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { package: created } = (await res.json()).data;
    made.push(created.id);
    return created;
  }
  const retire = (t) => ctx.put(`${API}/tests/${t.id}`, {
    headers: auth(su), data: { categoryId: t.category_id, name: t.name, price: Number(t.price), isActive: false },
  });
  const managed = async (id) => (await (await ctx.get(`${API}/packages/manage`, { headers: auth(su) })).json())
    .data.packages.find((p) => p.id === id);
  const onOffer = async (id) => (await (await ctx.get(`${API}/packages`)).json()).data.packages.find((p) => p.id === id);
  const walkIn = async (body) => {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: {
        patientTypeId: await patientTypeId(ctx, API, desk, 'Self Pay'), firstName: person.firstName, lastName: person.lastName,
        birthdate: '1985-06-20', sex: 'Female', address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    return ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', ...body } });
  };

  test('it comes out, and a package still under its tests stays on sale without it', async () => {
    const [a, b, c] = [await makeTest(500), await makeTest(500), await makeTest(100)];
    const pkg = await makePackage(600, [a, b, c]);

    const res = await retire(c);
    expect(res.status()).toBe(200);
    const body = (await res.json()).data.test;
    expect(body.packagesChanged.map((p) => p.id)).toEqual([pkg.id]);
    expect(body.packageNotice).toContain('came out of');

    const left = await onOffer(pkg.id);
    expect(left, 'still on sale: ₱600 against ₱1,000 of tests').toBeTruthy();
    expect(left.tests.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());

    // A booking bills its one price over the tests left, and the retired test reaches no department.
    const visit = await walkIn({ packageIds: [pkg.id] });
    expect(visit.status()).toBe(201);
    const lines = (await (await ctx.get(`${API}/tests/visit-tests/${(await visit.json()).data.visit.id}`, { headers: auth(desk) })).json()).data.visitTests;
    expect(lines.map((l) => l.test_id)).not.toContain(c.id);
    expect(lines.reduce((sum, l) => sum + Number(l.price_at_time), 0).toFixed(2)).toBe('600.00');
  });

  test('a package that would cost more than its tests goes off sale, and comes back only when it fits', async () => {
    const [a, b, c] = [await makeTest(300), await makeTest(300), await makeTest(500)];
    const pkg = await makePackage(900, [a, b, c]);

    const body = (await (await retire(c)).json()).data.test;
    expect(body.packagesChanged[0].offSale).toBe('dearer_than_tests');
    expect(body.packageNotice).toMatch(/off sale until repriced/);

    expect(await onOffer(pkg.id), 'not offered to patients').toBeFalsy();
    expect((await walkIn({ packageIds: [pkg.id] })).status(), 'nor at the desk').toBe(400);

    const again = (data) => ctx.patch(`${API}/packages/${pkg.id}`, { headers: auth(su), data });
    expect((await again({ isActive: true })).status(), 'still ₱900 for ₱600 of tests').toBe(400);
    expect((await again({ price: 550 })).status(), 'repriced').toBe(200);
    expect((await again({ isActive: true })).status(), 'now it fits').toBe(200);
    expect((await onOffer(pkg.id)).tests).toHaveLength(2);
  });

  test('its note says which test came out and what to fix, and goes once it is offered again', async () => {
    const [a, b, c] = [await makeTest(300), await makeTest(300), await makeTest(500)];
    const pkg = await makePackage(900, [a, b, c]);
    await retire(c);

    let row = await managed(pkg.id);
    expect(row.retiredTests.map((t) => t.id)).toEqual([c.id]);
    expect(row.offSaleNote).toContain(`${c.name} is inactive and came out of this package`);
    expect(row.offSaleNote).toContain('₱900.00');
    expect(row.offSaleNote).toContain('₱600.00');
    expect(row.offSaleNote).toContain('Lower the price or add a test');

    // Patients are shown no note and no package: only the management list carries it.
    expect(await onOffer(pkg.id)).toBeFalsy();

    // The test back on: the note says so, and the package still is not fixed by that alone.
    await ctx.put(`${API}/tests/${c.id}`, { headers: auth(su), data: { categoryId: c.category_id, name: c.name, price: 500, isActive: true } });
    row = await managed(pkg.id);
    expect(row.offSaleNote).toContain('active again: add it back');

    // Put back into the package, it no longer counts as one that came out.
    expect((await ctx.patch(`${API}/packages/${pkg.id}`, { headers: auth(su), data: { testIds: [a.id, b.id, c.id] } })).status()).toBe(200);
    row = await managed(pkg.id);
    expect(row.retiredTests).toEqual([]);
    expect(row.offSaleNote, 'nothing wrong and nothing taken out: an ordinary retired package').toBeNull();

    expect((await ctx.patch(`${API}/packages/${pkg.id}`, { headers: auth(su), data: { isActive: true } })).status()).toBe(200);
    row = await managed(pkg.id);
    expect(row.isActive).toBe(true);
    expect(row.offSaleNote).toBeNull();
  });

  test('offered again after a fix, what came out is forgotten; one that stayed on sale never carried a note', async () => {
    const [a, b, c] = [await makeTest(300), await makeTest(300), await makeTest(500)];
    const pkg = await makePackage(900, [a, b, c]);
    await retire(c);
    expect((await ctx.patch(`${API}/packages/${pkg.id}`, { headers: auth(su), data: { price: 550 } })).status()).toBe(200);
    expect((await managed(pkg.id)).offSaleNote).toContain('It fits as it stands');
    expect((await ctx.patch(`${API}/packages/${pkg.id}`, { headers: auth(su), data: { isActive: true } })).status()).toBe(200);
    expect((await managed(pkg.id)).retiredTests).toEqual([]);

    const [d, e, f] = [await makeTest(500), await makeTest(500), await makeTest(100)];
    const stays = await makePackage(600, [d, e, f]);
    await retire(f);
    const row = await managed(stays.id);
    expect(row.isActive).toBe(true);
    expect(row.retiredTests).toEqual([]);
    expect(row.offSaleNote).toBeNull();
  });

  test('a package left with one test goes off sale, and cannot be offered until it has two', async () => {
    const [a, b] = [await makeTest(300), await makeTest(300)];
    const pkg = await makePackage(500, [a, b]);
    const body = (await (await retire(a)).json()).data.test;
    expect(body.packagesChanged[0].offSale).toBe('too_few');
    expect(await onOffer(pkg.id)).toBeFalsy();

    const res = await ctx.patch(`${API}/packages/${pkg.id}`, { headers: auth(su), data: { isActive: true } });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/fewer than two tests/);
  });

  test("switching it back on does not put it back: what a package holds is someone's decision", async () => {
    const [a, b, c] = [await makeTest(500), await makeTest(500), await makeTest(100)];
    const pkg = await makePackage(600, [a, b, c]);
    await retire(c);
    const res = await ctx.put(`${API}/tests/${c.id}`, {
      headers: auth(su), data: { categoryId: c.category_id, name: c.name, price: 100, isActive: true },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.test.packagesChanged).toEqual([]);
    expect((await managed(pkg.id)).tests.map((t) => t.id)).not.toContain(c.id);
  });

  test('a visit already made keeps its lines and its bill', async () => {
    const [a, b, c] = [await makeTest(500), await makeTest(500), await makeTest(100)];
    const pkg = await makePackage(900, [a, b, c]);
    const visit = (await (await walkIn({ packageIds: [pkg.id] })).json()).data.visit;
    await retire(c);
    const lines = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(desk) })).json()).data.visitTests;
    expect(lines).toHaveLength(3);
    expect(lines.reduce((sum, l) => sum + Number(l.price_at_time), 0).toFixed(2)).toBe('900.00');
  });

  test('a lower price can take a package off sale too, by either way of changing it; a higher one cannot', async () => {
    const [a, b] = [await makeTest(500), await makeTest(500)];
    const one = await makePackage(900, [a, b]);
    const up = await ctx.patch(`${API}/tests/${a.id}/price`, { headers: auth(su), data: { price: 600 } });
    expect((await up.json()).data.test.packagesChanged).toEqual([]);

    const down = await ctx.patch(`${API}/tests/${a.id}/price`, { headers: auth(su), data: { price: 100 } });
    expect(down.status()).toBe(200);
    expect((await down.json()).data.test.packageNotice).toMatch(/off sale until repriced/);
    expect(await onOffer(one.id)).toBeFalsy();

    const [c, d] = [await makeTest(500), await makeTest(500)];
    const two = await makePackage(900, [c, d]);
    const edited = await ctx.put(`${API}/tests/${c.id}`, {
      headers: auth(su), data: { categoryId: c.category_id, name: c.name, price: 100 },
    });
    expect((await edited.json()).data.test.packagesChanged[0].id).toBe(two.id);
    expect(await onOffer(two.id)).toBeFalsy();
  });

  test('the catalogue says it before it happens and after, and every change is logged', async ({ page }) => {
    const [a, b, c] = [await makeTest(300), await makeTest(300), await makeTest(500)];
    const pkg = await makePackage(900, [a, b, c]);

    await signInTo(page, 'clinicadmin@enlogada.com', 'Services Catalog');
    // The Packages table below names its tests too, so the row with the switch.
    const row = page.locator('tr', { hasText: c.name }).filter({ has: page.getByTestId('service-toggle') });
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 20000 });
    // The catalogue pages in the browser; a click renders at once, so a short pause reads each page.
    for (let i = 0; i < 30 && !(await row.isVisible()); i += 1) {
      const next = page.getByRole('button', { name: 'Next page' }).first();
      if (await next.isDisabled()) break;
      await next.click();
      await page.waitForTimeout(150);
    }
    await row.getByTestId('service-toggle').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`It also comes out of`);
    await expect(dialog).toContainText(pkg.name);
    await dialog.getByRole('button', { name: 'Deactivate', exact: true }).click();

    const notice = page.getByTestId('package-notice');
    await expect(notice).toContainText(pkg.name);
    await expect(notice).toContainText('off sale until repriced');
    // The notice was for the moment it happened. This stays until the package is fixed. [1.159.0]
    await expect(page.getByTestId('packages-to-fix')).toHaveCount(0);
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.getByTestId('packages-to-fix')).toContainText(pkg.name);
    await expect(row.getByTestId('test-package-note')).toContainText(`came out of ${pkg.name}`);
    const packageRow = page.locator('tr', { hasText: pkg.name }).filter({ has: page.getByTestId('package-off-sale-note') });
    await expect(packageRow.getByTestId('package-off-sale-note')).toContainText(`${c.name} is inactive and came out of this package`);
    await expect(packageRow.getByTestId('package-off-sale-note')).toContainText('Patients cannot see it until it is fixed');
    await expect(packageRow.getByRole('button', { name: 'Off sale' })).toBeVisible();

    const log = await (await ctx.get(`${API}/admin/activity`, { headers: auth(su), params: { limit: 10 } })).text();
    expect(log).toContain(`${pkg.name} taken off sale`);
  });
});
