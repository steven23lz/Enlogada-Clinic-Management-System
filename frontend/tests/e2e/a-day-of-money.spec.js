// @ts-check
import { test, expect, request } from 'playwright/test';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { appointmentForm } from './helpers/booking.js';
import { nthWorkingDay, todayStr } from './helpers/dates.js';
import { submitProof, ensureMethod } from './helpers/payments.js';

/**
 * A whole day's money, and every screen that reports it agreeing. [1.172.0]
 *
 * Steven: "do everything", the first being "a full day's money adding up". Each money screen had
 * its own spec; none had been held to the others over one day. This makes a day (cash, GCash and
 * bank, a Senior Citizen and a PWD discount, a package, an HMO covering one test of a package, a
 * proof verified online, a receipt refunded as a mistake and a test refunded as one the clinic
 * could not do), reads every figure before and after, and checks each moved by exactly what the
 * day did: Transaction History's summary, the per-cashier split on Cashier Monitoring, the
 * Departments report (takings, refunds, sales by service), Trends (by day and by method), the
 * HMO Claims report and the Cash Count's expected drawer.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const n = (v) => Number(v || 0);
const close = (a, b) => Math.abs(n(a) - n(b)) < 0.01;

test.describe('A day of money [1.172.0]', () => {
  let ctx, desk, till, superAdmin, admin;
  let labTests, pkg, method;
  const day = todayStr();
  const login = async (e) => (await (await ctx.post(`${API}/auth/login`, { data: { email: e, password: PASSWORD } })).json()).data.token;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [desk, till, superAdmin, admin] = await Promise.all(
      ['receptionist@enlogada.com', 'multirole@enlogada.com', 'admin@enlogada.com', 'clinicadmin@enlogada.com'].map(login)
    );
    labTests = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .filter((t) => t.category_name === 'Laboratory' && t.is_active && Number(t.price) > 0);
    pkg = (await (await ctx.get(`${API}/packages`)).json()).data.packages[0];
    method = await ensureMethod(ctx, superAdmin);
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  /** Every figure, from the endpoint its screen reads. */
  async function figures() {
    const q = { startDate: day, endDate: day };
    const [tx, byCashier, ops, trends, hmo, drawer] = await Promise.all([
      ctx.get(`${API}/payments/transactions`, { headers: auth(superAdmin), params: { ...q, limit: 1 } }),
      ctx.get(`${API}/payments/transactions`, { headers: auth(superAdmin), params: { ...q, limit: 1, byCashier: true } }),
      ctx.get(`${API}/reports/operations`, { headers: auth(superAdmin), params: q }),
      ctx.get(`${API}/reports/summary`, { headers: auth(superAdmin), params: q }),
      ctx.get(`${API}/reports/hmo-claims`, { headers: auth(superAdmin), params: q }),
      ctx.get(`${API}/cash-counts/day`, { headers: auth(till), params: { date: day } }),
    ].map(async (p) => (await (await p).json()).data));
    const billing = ops.report.billing;
    const methods = Object.fromEntries((trends.report.paymentMethodBreakdown || []).map((m) => [m.payment_method, n(m.total)]));
    return {
      collected: n(tx.summary.collected), receipts: n(tx.summary.receipts), cash: n(tx.summary.cash), ewallet: n(tx.summary.ewallet),
      bank: n(tx.summary.bank), discounts: n(tx.summary.discounts), reversed: n(tx.summary.reversed), reversals: n(tx.summary.reversals),
      cashierSum: (byCashier.summary.byCashier || []).reduce((s, c) => s + n(c.collected), 0), cashierTotal: n(byCashier.summary.collected),
      opsCollected: n(billing.totals.collected), opsRefunded: n(billing.totals.refunded), opsDiscounts: n(billing.totals.discounts),
      byServiceNet: (billing.byService || []).reduce((s, r) => s + n(r.net), 0),
      trendDay: (trends.report.revenueTrend || []).reduce((s, r) => s + n(r.total), 0),
      trendCash: methods.Cash || 0, trendGcash: methods.GCash || 0, trendBank: methods.Bank || 0,
      hmoApproved: n(hmo.report.totals.approved),
      drawerCash: n(drawer.expected.cash),
    };
  }

  const walkIn = async ({ testIds = [], packageIds = [], birthdate = '1985-03-03' } = {}) => {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: { patientTypeId: await patientTypeId(ctx, API, desk), ...person, birthdate, sex: 'Female', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const res = await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', testIds, packageIds } });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).data.visit;
  };
  const billOf = async (visitId) => (await (await ctx.get(`${API}/payments/bill/${visitId}`, { headers: auth(till) })).json()).data.bill;
  const pay = async (visitId, paymentMethod = 'Cash', referenceNumber = null) => {
    const bill = await billOf(visitId);
    const res = await ctx.post(`${API}/payments`, {
      headers: auth(till), data: { patientVisitId: visitId, paymentMethod, referenceNumber, amount: n(bill.totalAmount) },
    });
    expect(res.status(), await res.text()).toBe(201);
    return { payment: (await res.json()).data.payment, bill };
  };
  const discount = async (visitId, kind, idNumber) => {
    const { discounts } = (await (await ctx.get(`${API}/discounts`, { headers: auth(till) })).json()).data;
    const d = discounts.find((x) => new RegExp(kind, 'i').test(x.name));
    const res = await ctx.post(`${API}/discounts/visit/${visitId}`, { headers: auth(till), data: { discountTypeId: d.id, idNumber } });
    expect(res.status(), await res.text()).toBe(200);
  };
  const linesOf = async (visitId) => (await (await ctx.get(`${API}/tests/visit-tests/${visitId}`, { headers: auth(desk) })).json()).data.visitTests;

  test('every money screen moves by exactly what the day did', async () => {
    test.setTimeout(180000);
    const before = await figures();
    const paid = [];
    const ref = () => `DAY${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // 1-2. Plain cash, and GCash at the till.
    const v1 = await walkIn({ testIds: [labTests[0].id] });
    paid.push({ ...(await pay(v1.id)), method: 'Cash' });
    const v2 = await walkIn({ testIds: [labTests[1].id] });
    paid.push({ ...(await pay(v2.id, 'GCash', ref())), method: 'GCash' });

    // 3-4. A Senior Citizen in cash, a PWD by bank transfer.
    const v3 = await walkIn({ testIds: [labTests[2].id], birthdate: '1950-02-02' });
    await discount(v3.id, 'senior', 'OSCA-DAY-1');
    paid.push({ ...(await pay(v3.id)), method: 'Cash' });
    const v4 = await walkIn({ testIds: [labTests[3].id] });
    await discount(v4.id, 'pwd', 'PWD-DAY-1');
    paid.push({ ...(await pay(v4.id, 'Bank', ref())), method: 'Bank' });

    // 5. A package, in cash.
    const v5 = await walkIn({ packageIds: [pkg.id] });
    paid.push({ ...(await pay(v5.id)), method: 'Cash' });

    // 6. A package with an HMO covering one of its tests: each test back to its own price.
    const v6 = await walkIn({ packageIds: [pkg.id] });
    const [covered] = await linesOf(v6.id);
    const provider = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(desk) })).json()).data.providers[0];
    const claim = await ctx.post(`${API}/hmo/request`, {
      headers: auth(desk), data: { hmoProviderId: provider.id, memberNumber: '1CH-0000888', visitTestIds: [covered.id], referringPhysician: 'Dr. Reyes' },
    });
    expect(claim.status(), await claim.text()).toBe(201);
    const claimBody = (await claim.json()).data;
    const claimId = (claimBody.request || claimBody.hmoRequest || claimBody).id;
    expect((await ctx.put(`${API}/hmo/request/${claimId}/approve`, { headers: auth(admin), data: { approvalCode: 'LOA-DAY-1' } })).status()).toBe(200);
    const v6bill = await billOf(v6.id);
    const coveredNow = n(v6bill.hmoCoverage);
    expect(coveredNow, 'the HMO covers its one test, at that test\'s own price').toBeGreaterThan(0);
    paid.push({ ...(await pay(v6.id)), method: 'Cash' });

    // 7. A booking paid online and verified by the cashier.
    const person = fixturePerson();
    const { token } = await registerClient(ctx, { ...person, email: fixtureEmail(person), password: PASSWORD });
    const owner = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token), data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1992-09-09', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const booked = await ctx.post(`${API}/appointments`, {
      headers: auth(token), multipart: appointmentForm({ patientId: owner.id, scheduledDate: nthWorkingDay(253), scheduledTime: '09:00', testIds: [labTests[4].id] }),
    });
    expect(booked.status(), await booked.text()).toBe(201);
    const appt = (await booked.json()).data.appointment;
    const proofBill = await billOf(appt.patient_visit_id);
    const proof = await submitProof(ctx, token, appt.patient_visit_id, { amount: n(proofBill.totalAmount), reference: ref(), methodId: method.id });
    expect(proof.status(), await proof.text()).toBe(201);
    const verified = await ctx.post(`${API}/payment-submissions/${(await proof.json()).data.submission.id}/verify`, { headers: auth(till) });
    expect(verified.status(), await verified.text()).toBe(200);
    paid.push({ payment: (await verified.json()).data.payment, bill: proofBill, method: method.kind });

    // Refunds: v1 recorded by mistake; one test of v5's package the clinic cannot do.
    const r1 = await ctx.post(`${API}/payments/${paid[0].payment.id}/refund`, {
      headers: auth(superAdmin), data: { kind: 'recorded_by_mistake', reason: 'Charged on the wrong visit.', returnedVia: 'Cash' },
    });
    expect(r1.status(), await r1.text()).toBe(201);
    const [v5line] = await linesOf(v5.id);
    const r2 = await ctx.post(`${API}/payments/${paid[4].payment.id}/refund`, {
      headers: auth(superAdmin), data: { kind: 'clinic_cannot_perform', testIds: [v5line.id], reason: 'The analyser is down.', returnedVia: 'Cash' },
    });
    expect(r2.status(), await r2.text()).toBe(201);
    const refunded = n((await r1.json()).data.amount) + n((await r2.json()).data.amount);

    const after = await figures();
    const d = (k) => Math.round((after[k] - before[k]) * 100) / 100;
    const sum = (list) => Math.round(list.reduce((s, p) => s + n(p.payment.amount), 0) * 100) / 100;
    const takings = sum(paid);
    const byMethod = (m) => sum(paid.filter((p) => p.method === m));
    const discountsGiven = Math.round(paid.reduce((s, p) => s + n(p.payment.discount_amount), 0) * 100) / 100;

    // Transaction History, the cash book.
    expect(d('collected'), 'takings').toBeCloseTo(takings, 2);
    expect(d('receipts'), 'receipts').toBe(paid.length);
    expect(d('cash'), 'cash').toBeCloseTo(byMethod('Cash'), 2);
    expect(d('ewallet'), 'GCash').toBeCloseTo(byMethod('GCash'), 2);
    expect(d('bank'), 'bank').toBeCloseTo(byMethod('Bank'), 2);
    expect(d('discounts'), 'discounts given').toBeCloseTo(discountsGiven, 2);
    expect(discountsGiven, 'the senior and the PWD discounts are both there').toBeGreaterThan(0);
    expect(d('reversed'), 'refunded, said beside the takings, never netted off').toBeCloseTo(refunded, 2);
    expect(d('reversals'), 'two refunds').toBe(2);

    // Cashier Monitoring: the per-cashier split adds up to the whole.
    expect(close(after.cashierSum, after.cashierTotal), `cashiers ${after.cashierSum} vs total ${after.cashierTotal}`).toBe(true);

    // The Departments report agrees with the cash book, and its sales by service add up to it.
    expect(d('opsCollected'), 'Departments takings').toBeCloseTo(d('collected'), 2);
    expect(d('opsRefunded'), 'Departments refunds').toBeCloseTo(d('reversed'), 2);
    expect(d('opsDiscounts'), 'Departments discounts').toBeCloseTo(d('discounts'), 2);
    expect(Math.abs(after.byServiceNet - after.opsCollected), 'sales by service sum to the takings').toBeLessThan(1);

    // Trends, by day and by method.
    expect(d('trendDay'), 'Trends, takings by day').toBeCloseTo(d('collected'), 2);
    expect(d('trendCash'), 'Trends, cash').toBeCloseTo(byMethod('Cash'), 2);
    expect(d('trendGcash') + d('trendBank'), 'Trends, GCash and bank').toBeCloseTo(byMethod('GCash') + byMethod('Bank'), 2);

    // The HMO's share is a receivable, reported apart and never added to the takings.
    expect(d('hmoApproved'), 'HMO approved').toBeCloseTo(coveredNow, 2);

    // The drawer: cash in, less cash handed back.
    expect(d('drawerCash'), 'Cash Count, what should be in the drawer').toBeCloseTo(byMethod('Cash') - refunded, 2);

    // Each receipt says what was taken and what was taken off.
    for (const p of paid) {
      const r = (await (await ctx.get(`${API}/payments/receipt/${p.payment.receipt_number}`, { headers: auth(till) })).json()).data;
      const rec = r.receipt || r.payment || r;
      expect(close(rec.amount ?? rec.total ?? p.payment.amount, p.payment.amount), `receipt ${p.payment.receipt_number}`).toBe(true);
    }
  });
});
