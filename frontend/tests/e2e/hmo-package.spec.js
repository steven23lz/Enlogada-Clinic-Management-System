// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo } from './helpers/auth.js';
import { openPortalTab, openBooking, BOOKING_STEP_TWO } from './helpers/portal.js';
import { appointmentForm, removeUnpaid } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { registerClient } from './helpers/accounts.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { patientTypeId } from './helpers/patients.js';
import { API, CREDS, loginAs, submitProof, ensureMethod } from './helpers/payments.js';

/**
 * An HMO claim on tests inside a package, followed to the bill and the till. [1.158.0] [1.159.0]
 *
 * Steven's rule: a package price is for the package. If the HMO covers only part of it, every test goes
 * back to its own price, so Package A (₱1,450, six tests worth ₱1,650) with only HIV covered is ₱500 to
 * the HMO and ₱1,150 to the patient. Nothing covered, or all of it, keeps the package price. And "my HMO
 * said no, so I won't have that test" had no way through: the desk was told "This is still in use".
 */

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const money = (n) => Number(n).toFixed(2);
const REASON = 'Not covered by the plan';

test.describe('HMO claims and packages [1.158.0]', () => {
  let ctx;
  let desk;
  let cashier;
  let admin;
  let superadmin;
  let pkg;
  let loose;
  let provider;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    desk = await loginAs(ctx, CREDS.receptionist);
    cashier = await loginAs(ctx, { email: 'multirole@enlogada.com', password: 'Password123!' });
    admin = await loginAs(ctx, CREDS.admin);
    superadmin = await loginAs(ctx, CREDS.superadmin);
    pkg = (await (await ctx.get(`${API}/packages`)).json()).data.packages.find((p) => !p.name.startsWith('E2E '));
    const inPackage = new Set(pkg.tests.map((t) => t.id));
    loose = (await (await ctx.get(`${API}/tests`)).json()).data.tests
      .filter((t) => t.is_active && !inPackage.has(t.id) && Number(t.price) > 0);
    provider = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(desk) })).json()).data.providers
      .find((p) => p.is_active !== false);
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  async function open(body) {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: {
        patientTypeId: await patientTypeId(ctx, API, desk, 'Self Pay'), firstName: person.firstName, lastName: person.lastName,
        birthdate: '1985-06-20', sex: 'Female', address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const res = await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', ...body } });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).data.visit.id;
  }
  const lines = async (v) => (await (await ctx.get(`${API}/tests/visit-tests/${v}`, { headers: auth(desk) })).json()).data.visitTests;
  const billOf = async (v) => (await (await ctx.get(`${API}/payments/bill/${v}`, { headers: auth(cashier) })).json()).data.bill;
  async function claim(ids) {
    const res = await ctx.post(`${API}/hmo/request`, {
      headers: auth(desk),
      data: { hmoProviderId: provider.id, memberNumber: '1CH-0000001', visitTestIds: ids, referringPhysician: 'Dr. Reyes' },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()).data;
    return (body.request || body.hmoRequest || body).id;
  }
  const approve = (id) => ctx.put(`${API}/hmo/request/${id}/approve`, { headers: auth(admin), data: { approvalCode: 'LOA-001' } });
  const refuse = (id) => ctx.put(`${API}/hmo/request/${id}/reject`, { headers: auth(admin), data: { decisionReason: REASON } });
  const remove = (lineId) => ctx.delete(`${API}/tests/visit-tests/${lineId}`, { headers: auth(desk) });
  const pay = async (v, extra = {}) => ctx.post(`${API}/payments`, {
    headers: auth(cashier),
    data: { patientVisitId: v, paymentMethod: 'Cash', amount: Number((await billOf(v)).totalAmount), ...extra },
  });
  const ownTotal = () => pkg.tests.reduce((sum, t) => sum + Number(t.price), 0);
  const claimRows = async (id) => (await (await ctx.get(`${API}/hmo/request/${id}`, { headers: auth(admin) })).json()).data.request.tests;
  const decide = (rowId, approvalStatus) => ctx.put(`${API}/hmo/request-test/${rowId}`, {
    headers: auth(admin),
    data: approvalStatus === 'Rejected' ? { approvalStatus, decisionReason: REASON } : { approvalStatus },
  });

  test('one test approved: every test goes back to its own price, and the till waited for the answer', async () => {
    const v = await open({ packageIds: [pkg.id] });
    const before = await lines(v);
    const covered = before[0];
    expect(money(before.reduce((sum, l) => sum + Number(l.price_at_time), 0))).toBe(money(pkg.price));
    const id = await claim([covered.id]);

    const early = await pay(v);
    expect(early.status(), 'no payment over a pending decision').toBe(409);
    expect(money((await billOf(v)).subtotal), 'still the package price while it waits').toBe(money(pkg.price));

    expect((await approve(id)).status()).toBe(200);
    const bill = await billOf(v);
    expect(money(bill.subtotal)).toBe(money(ownTotal()));
    expect(money(bill.hmoCoverage), 'the HMO pays its own price').toBe(money(covered.list_price));
    expect(money(bill.totalAmount)).toBe(money(ownTotal() - Number(covered.list_price)));
    expect(bill.packagesAtOwnPrice.map((p) => p.name)).toEqual([pkg.name]);
    expect(money(bill.packagesAtOwnPrice[0].packagePrice)).toBe(money(pkg.price));
    expect(money((await claimRows(id))[0].price_at_time), 'what the HMO report reads').toBe(money(covered.list_price));

    const paid = await pay(v);
    expect(paid.status()).toBe(201);
    expect(money((await paid.json()).data.payment.amount)).toBe(money(bill.totalAmount));
    const receipt = (await paid.json()).data.payment.receipt_number;
    const printed = (await (await ctx.get(`${API}/payments/receipt/${receipt}`, { headers: auth(cashier) })).json()).data;
    expect(printed.bill.packagesAtOwnPrice.map((p) => p.name), 'the receipt says why').toEqual([pkg.name]);

    // What was paid can be refunded; what the HMO covers cannot, and the two add up to what was paid.
    const payment = (await (await ctx.get(`${API}/payments/visit/${v}`, { headers: auth(cashier) })).json()).data.payments[0];
    const refundable = (await (await ctx.get(`${API}/payments/${payment.id}/refund`, { headers: auth(superadmin) })).json()).data.tests;
    expect(money(refundable.reduce((sum, t) => sum + Number(t.amount || 0), 0))).toBe(money(bill.totalAmount));
    expect(refundable.find((t) => t.hmoApproved).whyNot).toMatch(/HMO covers it/);
  });

  test('refused as a whole: the package costs its whole price', async () => {
    const v = await open({ packageIds: [pkg.id] });
    const [one] = await lines(v);
    const id = await claim([one.id]);
    expect((await refuse(id)).status()).toBe(200);
    const bill = await billOf(v);
    expect(money(bill.totalAmount)).toBe(money(pkg.price));
    expect(bill.packagesAtOwnPrice).toEqual([]);
    expect((await pay(v)).status()).toBe(201);
  });

  test('the whole package approved stays at the package price, and a change of one line ends it, and back', async () => {
    const v = await open({ packageIds: [pkg.id] });
    const all = await lines(v);
    const id = await claim(all.map((l) => l.id));
    expect((await approve(id)).status()).toBe(200);

    const whole = await billOf(v);
    expect(money(whole.subtotal)).toBe(money(pkg.price));
    expect(money(whole.totalAmount)).toBe('0.00');
    expect(whole.packagesAtOwnPrice).toEqual([]);

    const rows = await claimRows(id);
    expect((await decide(rows[0].id, 'Rejected')).status()).toBe(200);
    const split = await billOf(v);
    expect(money(split.subtotal)).toBe(money(ownTotal()));
    expect(money(split.totalAmount), 'the refused test, at its own price').toBe(money(all.find((l) => l.id === rows[0].visit_test_id).list_price));

    expect((await decide(rows[0].id, 'Approved')).status()).toBe(200);
    const back = await lines(v);
    expect(back.map((l) => money(l.price_at_time)), 'the same shares, to the centavo').toEqual(all.map((l) => money(l.price_at_time)));
  });

  test('the desk claims one test at a time: the split lasts only until the last is approved', async () => {
    const v = await open({ packageIds: [pkg.id] });
    const all = await lines(v);
    const ids = [];
    for (const line of all) ids.push(await claim([line.id]));
    expect((await approve(ids[0])).status()).toBe(200);
    expect(money((await billOf(v)).subtotal)).toBe(money(ownTotal()));
    for (const id of ids.slice(1)) expect((await approve(id)).status()).toBe(200);
    const bill = await billOf(v);
    expect(money(bill.subtotal)).toBe(money(pkg.price));
    expect(money(bill.totalAmount)).toBe('0.00');
  });

  test('a discount comes off what the patient pays at own prices; loose tests and other packages keep theirs', async () => {
    const v = await open({ packageIds: [pkg.id], testIds: [loose[0].id] });
    const all = await lines(v);
    const inPackage = all.filter((l) => l.package_id);
    const id = await claim([inPackage[0].id]);
    await approve(id);
    const pwd = (await (await ctx.get(`${API}/discounts`, { headers: auth(cashier) })).json()).data.discounts.find((d) => d.name === 'PWD');
    expect((await ctx.post(`${API}/discounts/visit/${v}`, { headers: auth(cashier), data: { discountTypeId: pwd.id, idNumber: 'PWD-10-0000-002' } })).status()).toBe(200);

    const bill = await billOf(v);
    const patientPays = ownTotal() - Number(inPackage[0].list_price) + Number(loose[0].price);
    expect(money(bill.subtotal)).toBe(money(ownTotal() + Number(loose[0].price)));
    expect(money(bill.discountAmount)).toBe(money(patientPays * Number(pwd.percentage) / 100));
    expect(money(all.find((l) => !l.package_id).price_at_time)).toBe(money(loose[0].price));
  });

  test('a paid bill never moves, whatever a decision says afterwards', async () => {
    const v = await open({ packageIds: [pkg.id] });
    const all = await lines(v);
    const id = await claim([all[0].id, all[1].id]);
    const rows = await claimRows(id);
    await decide(rows[0].id, 'Approved');
    const before = await billOf(v);
    expect((await pay(v, { withdrawPendingClaims: true })).status()).toBe(201);

    // A decision the receipt rests on stays as it was, by either route: refusing it afterwards left the
    // sales report away from the cash taken by the price of that test.
    const change = await decide(rows[0].id, 'Rejected');
    expect(change.status()).toBe(409);
    expect((await change.json()).message).toMatch(/paid, and its receipt was issued on this decision/);
    const whole = await refuse(id);
    expect(whole.status(), await whole.text()).toBe(409);

    const after = await billOf(v);
    expect(money(after.totalAmount)).toBe(money(before.totalAmount));
    expect(money(after.hmoCoverage)).toBe(money(before.hmoCoverage));
    const priceOf = new Map(before.items.map((i) => [i.id, money(i.price)]));
    for (const line of await lines(v)) expect(money(line.price_at_time)).toBe(priceOf.get(line.id));
  });

  test('a patient booking a package on their HMO is told first, and again when the figure moves', async ({ page }) => {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: 'Password123!' });
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1991-09-19', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;

    const date = nthWorkingDay(190);
    const slots = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(desk) })).json()).data.slots.filter((s) => s.available);
    const booked = await ctx.post(`${API}/appointments`, {
      headers: auth(token),
      multipart: appointmentForm(
        { patientId: patient.id, scheduledDate: date, scheduledTime: slots[0].time, packageIds: [pkg.id], hmo: { providerId: provider.id } },
        { hmoCard: true }
      ),
    });
    expect(booked.status(), await booked.text()).toBe(201);
    const { appointment, hmoRequest } = (await booked.json()).data;
    try {
      const rows = await claimRows(hmoRequest.id);
      const refused = rows[0];
      expect((await decide(refused.id, 'Rejected')).status()).toBe(200);
      for (const row of rows.slice(1)) expect((await decide(row.id, 'Approved')).status()).toBe(200);

      const mine = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(token) })).json()).data.bookings
        .find((b) => b.id === appointment.id);
      expect(mine.packages_at_own_price).toEqual([pkg.name]);
      const own = pkg.tests.find((t) => t.name === refused.test_name);
      expect(money(mine.amount_due), 'the refused test at its own price').toBe(money(own.price));
      expect(mine.hmo_status).toBe('Approved');

      await signIn(page, email, 'Password123!');
      await openPortalTab(page, 'appointments');
      await expect(page.getByTestId('booking-package-own-price')).toContainText(`Your HMO covers only part of ${pkg.name}`);

      const dialog = await openBooking(page);
      await dialog.locator('#slotpicker-label').fill(date);
      await dialog.locator(`[data-testid="slot-${slots[1].time}"]`).click();
      await dialog.locator(`[data-package-code="${pkg.code}"]`).getByRole('checkbox').check();
      await dialog.getByRole('button', { name: BOOKING_STEP_TWO }).click();
      await expect(dialog.getByTestId('booking-package-hmo-rule')).toContainText('each test goes back to its own price');
    } finally {
      try { removeUnpaid(appointment.id); } catch { /* the suite's own clean-up has it */ }
    }
  });

  test('a package taking over a test the HMO already approved starts at own prices', async () => {
    const test0 = pkg.tests[0];
    const v = await open({ testIds: [test0.id] });
    const [line] = await lines(v);
    await approve(await claim([line.id]));
    const added = await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(desk), data: { patientVisitId: v, packageIds: [pkg.id], testIds: [] },
    });
    expect(added.status(), await added.text()).toBe(201);
    const bill = await billOf(v);
    expect(money(bill.subtotal)).toBe(money(ownTotal()));
    expect(money(bill.hmoCoverage)).toBe(money(test0.price));
  });

  test('a payment waiting to be checked holds the claim as well: a decision could move the bill under it', async () => {
    const v = await open({ packageIds: [pkg.id] });
    const all = await lines(v);
    const id = await claim([all[0].id]);
    await approve(id);
    const [row] = await claimRows(id);
    const method = await ensureMethod(ctx, superadmin);
    const sent = await submitProof(ctx, desk, v, { amount: (await billOf(v)).totalAmount, reference: `E2E-HMO-${Date.now()}`, methodId: method.id });
    expect(sent.status(), await sent.text()).toBe(201);

    const change = await decide(row.id, 'Rejected');
    expect(change.status()).toBe(409);
    expect((await change.json()).message).toMatch(/waiting to be checked/i);

    const another = await ctx.post(`${API}/hmo/request`, {
      headers: auth(desk),
      data: { hmoProviderId: provider.id, memberNumber: '1CH-0000001', visitTestIds: [all[1].id], referringPhysician: 'Dr. Reyes' },
    });
    expect(another.status(), 'a new claim waits too').toBe(409);
    expect(money((await billOf(v)).subtotal), 'nothing moved').toBe(money(ownTotal()));
  });

  test('the Admin is told before deciding, and the cashier sees why on the bill', async ({ page }) => {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: {
        patientTypeId: await patientTypeId(ctx, API, desk, 'Self Pay'), firstName: person.firstName, lastName: person.lastName,
        birthdate: '1985-06-20', sex: 'Female', address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const res = await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', packageIds: [pkg.id] } });
    const { id: v, queue_number: ticket } = (await res.json()).data.visit;
    const [line] = await lines(v);
    const id = await claim([line.id]);

    const about = (await (await ctx.get(`${API}/hmo/request/${id}`, { headers: auth(admin) })).json()).data.request.packages;
    expect(about).toHaveLength(1);
    expect(about[0]).toMatchObject({ name: pkg.name, atOwnPrice: false, onThisClaim: 1, tests: pkg.tests.length });

    await signInTo(page, 'clinicadmin@enlogada.com', 'Service Requests');
    await page.getByRole('row', { name: new RegExp(`${person.lastName}.*Ticket ${ticket}`) }).getByRole('button', { name: 'Review' }).click({ timeout: 20000 });
    const note = page.getByRole('dialog').getByTestId('claim-package-note');
    await expect(note).toContainText(`1 of the ${pkg.tests.length} tests in ${pkg.name}`);
    await expect(note).toContainText('goes back to its own price');
    await page.keyboard.press('Escape');

    await approve(id);
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await signInTo(page, 'cashier@enlogada.com', 'Billing Queue');
    await page.getByPlaceholder('Search ticket # or name...').fill(person.lastName);
    await page.getByRole('button', { name: new RegExp(person.fullName) }).first().click({ timeout: 20000 });
    await expect(page.getByTestId('package-own-price')).toContainText(`${pkg.name}: the HMO covers only part of it`);
  });

  test('every other line refused: the patient pays exactly the refused tests, at their own prices', async () => {
    const v = await open({ packageIds: [pkg.id] });
    const all = await lines(v);
    const id = await claim(all.map((l) => l.id));
    const rows = (await (await ctx.get(`${API}/hmo/request/${id}`, { headers: auth(admin) })).json()).data.request.tests;
    let refused = 0;
    for (const [i, row] of rows.entries()) {
      const no = i % 2 === 0;
      const res = await ctx.put(`${API}/hmo/request-test/${row.id}`, {
        headers: auth(admin), data: no ? { approvalStatus: 'Rejected', decisionReason: REASON } : { approvalStatus: 'Approved' },
      });
      expect(res.status(), await res.text()).toBe(200);
      if (no) refused += Number(all.find((l) => l.id === row.visit_test_id).list_price);
    }
    expect(money((await billOf(v)).totalAmount)).toBe(money(refused));
    expect((await pay(v)).status()).toBe(201);
  });

  test('"my HMO said no, so I won\'t have that test": it comes off, and the refusal stays on the log', async () => {
    const v = await open({ testIds: [loose[0].id, loose[1].id] });
    const [first, second] = await lines(v);
    const id = await claim([first.id]);

    const waiting = await remove(first.id);
    expect(waiting.status()).toBe(409);
    expect((await waiting.json()).message).toMatch(/waiting for .*decision/);

    expect((await refuse(id)).status()).toBe(200);
    const gone = await remove(first.id);
    expect(gone.status(), await gone.text()).toBe(200);
    expect((await lines(v)).map((l) => l.id)).toEqual([second.id]);
    expect(money((await billOf(v)).totalAmount)).toBe(money(second.price_at_time));

    // A claim with nothing left on it is gone from the Admin's list too.
    expect((await ctx.get(`${API}/hmo/request/${id}`, { headers: auth(admin) })).status()).toBe(404);
    const log = await (await ctx.get(`${API}/admin/activity`, { headers: auth(superadmin), params: { limit: 10 } })).text();
    expect(log).toContain(REASON);
  });

  test('one line refused off a claim of two: the other stays on the claim', async () => {
    const v = await open({ testIds: [loose[0].id, loose[1].id, loose[2].id] });
    const [a, b] = await lines(v);
    const id = await claim([a.id, b.id]);
    const rows = (await (await ctx.get(`${API}/hmo/request/${id}`, { headers: auth(admin) })).json()).data.request.tests;
    const row = rows.find((r) => r.visit_test_id === a.id);
    await ctx.put(`${API}/hmo/request-test/${row.id}`, { headers: auth(admin), data: { approvalStatus: 'Rejected', decisionReason: REASON } });

    expect((await remove(a.id)).status()).toBe(200);
    const left = (await (await ctx.get(`${API}/hmo/request/${id}`, { headers: auth(admin) })).json()).data.request.tests;
    expect(left.map((r) => r.visit_test_id)).toEqual([b.id]);
  });

  test('approved stays until an Admin changes the decision; the refusal says who can', async () => {
    const v = await open({ testIds: [loose[0].id, loose[1].id] });
    const [first] = await lines(v);
    const id = await claim([first.id]);
    await approve(id);

    const res = await remove(first.id);
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toMatch(/approved .*an Admin changes that decision/);

    const rows = (await (await ctx.get(`${API}/hmo/request/${id}`, { headers: auth(admin) })).json()).data.request.tests;
    const changed = await ctx.put(`${API}/hmo/request-test/${rows[0].id}`, {
      headers: auth(admin), data: { approvalStatus: 'Rejected', decisionReason: 'Patient no longer wants the test' },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    expect((await remove(first.id)).status()).toBe(200);
  });

  test('a package with one refused line comes off whole; with one still waiting, it stays whole', async () => {
    const v = await open({ packageIds: [pkg.id], testIds: [loose[0].id] });
    const inPackage = (await lines(v)).filter((l) => l.package_id);
    const id = await claim([inPackage[0].id]);

    expect((await remove(inPackage[1].id)).status(), 'one of its tests is waiting').toBe(409);
    expect((await lines(v)).filter((l) => l.package_id)).toHaveLength(inPackage.length);

    await refuse(id);
    expect((await remove(inPackage[1].id)).status()).toBe(200);
    expect((await lines(v)).filter((l) => l.package_id)).toHaveLength(0);
    expect(money((await billOf(v)).totalAmount)).toBe(money(loose[0].price));
  });
});
