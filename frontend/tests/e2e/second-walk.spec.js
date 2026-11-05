// @ts-check
import { test, expect, request } from 'playwright/test';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { patientTypeId } from './helpers/patients.js';
import { registerClient } from './helpers/accounts.js';
import { API, CREDS, loginAs } from './helpers/payments.js';

/**
 * What a second walk through the combinations found. [1.160.0]
 *
 * Steven: "can u check if theres more bug". Each of these was accepted, or stuck, when tried.
 */

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const money = (n) => Number(n).toFixed(2);
const REASON = "Member's policy lapsed";

test.describe('A second walk through the combinations [1.160.0]', () => {
  let ctx;
  let desk;
  let cashier;
  let admin;
  let provider;
  let lab;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    desk = await loginAs(ctx, CREDS.receptionist);
    cashier = await loginAs(ctx, { email: 'multirole@enlogada.com', password: 'Password123!' });
    admin = await loginAs(ctx, CREDS.admin);
    provider = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(desk) })).json()).data.providers[0];
    lab = (await (await ctx.get(`${API}/tests`)).json()).data.tests.filter((t) => t.is_active && Number(t.price) > 0);
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  async function patientAndVisit(over = {}) {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: {
        patientTypeId: await patientTypeId(ctx, API, desk, 'Self Pay'), firstName: person.firstName, lastName: person.lastName,
        birthdate: '1985-06-20', sex: 'Female', address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, ...over,
      },
    })).json()).data.patient;
    const res = await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', testIds: [lab[0].id, lab[1].id] } });
    expect(res.status(), await res.text()).toBe(201);
    return { patient, visitId: (await res.json()).data.visit.id };
  }
  const lines = async (v) => (await (await ctx.get(`${API}/tests/visit-tests/${v}`, { headers: auth(desk) })).json()).data.visitTests;
  const billOf = async (v) => (await (await ctx.get(`${API}/payments/bill/${v}`, { headers: auth(cashier) })).json()).data.bill;
  const claim = (ids) => ctx.post(`${API}/hmo/request`, {
    headers: auth(desk),
    data: { hmoProviderId: provider.id, memberNumber: '1CH-0000002', visitTestIds: ids, referringPhysician: 'Dr. Reyes' },
  });
  const idOf = async (res) => { const d = (await res.json()).data; return (d.request || d.hmoRequest || d).id; };
  const approve = (id, approvalCode = 'LOA-77') => ctx.put(`${API}/hmo/request/${id}/approve`, { headers: auth(admin), data: { approvalCode } });
  const refuse = (id) => ctx.put(`${API}/hmo/request/${id}/reject`, { headers: auth(admin), data: { decisionReason: REASON } });

  test('a claim refused as a whole can be raised again, and the retry decides the bill', async () => {
    const { visitId } = await patientAndVisit();
    const ids = (await lines(visitId)).map((l) => l.id);
    const first = await claim(ids);
    expect(first.status()).toBe(201);
    const firstId = await idOf(first);

    expect((await claim(ids)).status(), 'not while it waits').toBe(409);
    expect((await refuse(firstId)).status()).toBe(200);

    const stored = (await (await ctx.get(`${API}/hmo/request/${firstId}`, { headers: auth(admin) })).json()).data.request.tests;
    expect(stored.map((t) => t.approval_status)).toEqual(ids.map(() => 'Rejected'));

    const retry = await claim(ids);
    expect(retry.status(), await retry.text()).toBe(201);
    expect((await billOf(visitId)).hmoPendingCount).toBe(ids.length);
    expect((await approve(await idOf(retry))).status()).toBe(200);
    const bill = await billOf(visitId);
    expect(money(bill.totalAmount)).toBe('0.00');
    expect(money(bill.hmoCoverage)).toBe(money(bill.subtotal));
  });

  test('the HMO report counts a retried test once, by its latest answer', async () => {
    const { visitId } = await patientAndVisit();
    const [line] = await lines(visitId);
    const first = await idOf(await claim([line.id]));
    await refuse(first);
    const day = new Date();
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const totals = async () => {
      const { report } = (await (await ctx.get(`${API}/reports/hmo-claims`, { headers: auth(admin), params: { startDate: date, endDate: date } })).json()).data;
      const row = report.providers.find((p) => p.provider_name === provider.name);
      return { refused: Number(row?.refused || 0), approved: Number(row?.approved || 0) };
    };
    const before = await totals();
    await approve(await idOf(await claim([line.id])));
    const after = await totals();
    expect(money(after.approved - before.approved)).toBe(money(line.price_at_time));
    expect(money(before.refused - after.refused), 'it is no longer refused').toBe(money(line.price_at_time));
  });

  test('spaces are not an approval code', async () => {
    const { visitId } = await patientAndVisit();
    const [line] = await lines(visitId);
    const id = await idOf(await claim([line.id]));
    expect((await approve(id, '   ')).status()).toBe(400);
    expect((await approve(id, ' LOA-9 ')).status()).toBe(200);
    expect((await (await ctx.get(`${API}/hmo/request/${id}`, { headers: auth(admin) })).json()).data.request.approval_code).toBe('LOA-9');
  });

  test('a senior discount answers to the record when the money is taken', async () => {
    const { patient, visitId } = await patientAndVisit({ birthdate: '1950-01-01' });
    const senior = (await (await ctx.get(`${API}/discounts`, { headers: auth(cashier) })).json()).data.discounts.find((d) => d.name === 'Senior Citizen');
    expect((await ctx.post(`${API}/discounts/visit/${visitId}`, { headers: auth(cashier), data: { discountTypeId: senior.id, idNumber: 'OSCA-77' } })).status()).toBe(200);

    const pay = async () => ctx.post(`${API}/payments`, {
      headers: auth(cashier), data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: Number((await billOf(visitId)).totalAmount) },
    });
    const fixed = await ctx.put(`${API}/patients/${patient.id}`, {
      headers: auth(desk),
      data: { firstName: patient.first_name, lastName: patient.last_name, birthdate: '1995-01-01', sex: patient.sex, patientTypeId: patient.patient_type_id },
    });
    expect(fixed.status(), await fixed.text()).toBe(200);

    const refused = await pay();
    expect(refused.status()).toBe(400);
    expect((await refused.json()).message).toMatch(/60 and over.*remove the discount/);

    expect((await ctx.delete(`${API}/discounts/visit/${visitId}`, { headers: auth(cashier) })).status()).toBe(200);
    expect((await pay()).status(), 'at the full price it goes through').toBe(201);
  });

  test('a name is a name, a phone has digits, and one account holds one of each person', async () => {
    const person = fixturePerson();
    const { token } = await registerClient(ctx, { ...person, email: `second-walk-${Date.now()}@enlogada-e2e.test`, password: 'Password123!' });
    const profile = (over = {}) => ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: 0, firstName: person.firstName, lastName: person.lastName, birthdate: '1991-09-19', sex: 'Male', contactNumber: FIXTURE_CONTACT, ...over,
      },
    });
    const typeId = await patientTypeId(ctx, API, token, 'Self Pay');
    for (const bad of [{ firstName: '12345' }, { firstName: '<script>alert(1)</script>' }, { lastName: '😀' }, { contactNumber: '-------' }]) {
      expect((await profile({ patientTypeId: typeId, ...bad })).status(), JSON.stringify(bad)).toBe(400);
    }
    expect((await profile({ patientTypeId: typeId })).status()).toBe(201);
    const again = await profile({ patientTypeId: typeId, firstName: person.firstName.toUpperCase() });
    expect(again.status()).toBe(409);
    expect((await again.json()).message).toMatch(/already on your account/);
    expect((await profile({ patientTypeId: typeId, firstName: `${person.firstName} Jr.` })).status(), 'someone else').toBe(201);
    expect((await profile({ patientTypeId: typeId, birthdate: '2015-03-03' })).status(), 'a namesake child').toBe(201);
  });
});
