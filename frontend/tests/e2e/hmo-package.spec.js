// @ts-check
import { test, expect, request } from 'playwright/test';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { patientTypeId } from './helpers/patients.js';
import { API, CREDS, loginAs } from './helpers/payments.js';

/**
 * An HMO claim on tests inside a package, followed to the bill and the till. [1.158.0]
 *
 * A package spreads one price across its tests, so what an HMO covers is that test's SHARE, and what
 * is left for the patient has to add back up to the package price to the centavo. And "my HMO said no,
 * so I won't have that test" had no way through: the desk was told "This is still in use", for good.
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
  const pay = async (v) => ctx.post(`${API}/payments`, {
    headers: auth(cashier),
    data: { patientVisitId: v, paymentMethod: 'Cash', amount: Number((await billOf(v)).totalAmount) },
  });

  test('one test approved: the patient pays the rest of the package, and the till waited for the answer', async () => {
    const v = await open({ packageIds: [pkg.id] });
    const [covered] = await lines(v);
    const id = await claim([covered.id]);

    const early = await pay(v);
    expect(early.status(), 'no payment over a pending decision').toBe(409);

    expect((await approve(id)).status()).toBe(200);
    const bill = await billOf(v);
    expect(money(bill.totalAmount)).toBe(money(Number(pkg.price) - Number(covered.price_at_time)));

    const paid = await pay(v);
    expect(paid.status()).toBe(201);
    expect(money((await paid.json()).data.payment.amount)).toBe(money(bill.totalAmount));

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
    expect(money((await billOf(v)).totalAmount)).toBe(money(pkg.price));
    expect((await pay(v)).status()).toBe(201);
  });

  test('every other line refused: the patient pays exactly the refused shares', async () => {
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
      if (no) refused += Number(all.find((l) => l.id === row.visit_test_id).price_at_time);
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
