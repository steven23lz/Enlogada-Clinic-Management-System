// @ts-check
import { test, expect, request } from 'playwright/test';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { patientTypeId } from './helpers/patients.js';
import { registerClient } from './helpers/accounts.js';
import { signIn, signInTo } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';
import { appointmentForm } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { runScript } from './helpers/backendScript.js';
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
    const { id, queue_number: ticket } = (await res.json()).data.visit;
    return { patient, visitId: id, ticket };
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

  test('[1.161.0] saving a staff account works: every edit answered 500', async () => {
    const su = await loginAs(ctx, CREDS.superadmin);
    const list = (await (await ctx.get(`${API}/admin/staff`, { headers: auth(su), params: { limit: 50 } })).json()).data;
    const person = (list.staff || list.accounts || list.users || list).find((s) => s.email === 'lab@enlogada.com');
    const res = await ctx.patch(`${API}/admin/staff/${person.id}`, {
      headers: auth(su),
      data: { firstName: person.first_name, lastName: person.last_name, email: person.email, contactNumber: person.contact_number || '09000000000' },
    });
    expect(res.status(), await res.text()).toBe(200);
  });

  test('[1.161.0] the Desk can raise a claim for a walk-in with no doctor named, on several tests at once', async ({ page }) => {
    const { patient, visitId, ticket } = await patientAndVisit();
    const all = await lines(visitId);
    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    await page.getByRole('searchbox', { name: "Who's here?" }).fill(patient.last_name);
    const row = page.locator('tr', { hasText: ticket }).filter({ hasText: patient.last_name }).first();
    await row.getByRole('button', { name: new RegExp(`Log HMO pre-authorization for ${all[0].test_name}`) }).click({ timeout: 20000 });

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox').first().click();
    await page.getByRole('option', { name: provider.name, exact: true }).click();
    await dialog.getByRole('button', { name: 'Log HMO Request', exact: true }).click();
    await expect(dialog, 'not sent without one').toBeVisible();
    expect(await dialog.getByPlaceholder(/Dr\./).first().evaluate((el) => el.validity.valueMissing), 'asked for here, where it can be typed').toBe(true);

    await dialog.getByTestId('hmo-log-tests').getByRole('button', { name: /^All \d+$/ }).click();
    await dialog.getByPlaceholder(/Dr\./).first().fill('Dr. Reyes');
    await dialog.getByRole('button', { name: 'Log HMO Request', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15000 });

    const bill = await billOf(visitId);
    expect(bill.hmoPendingCount, 'one dialog, every test').toBe(all.length);
    await expect(row.getByTestId('test-hmo-status').first()).toContainText('HMO waiting', { timeout: 20000 });
    await expect(row.getByRole('button', { name: /Log HMO pre-authorization/ }), 'not offered twice').toHaveCount(0);
  });

  test('[1.161.0] the receipt adds up when an HMO covers part of the bill', async ({ page }) => {
    const { patient, visitId, ticket } = await patientAndVisit();
    const [first, second] = await lines(visitId);
    await approve(await idOf(await claim([first.id])));
    await signInTo(page, 'multirole@enlogada.com', 'Billing Queue');
    await page.getByPlaceholder('Search ticket # or name...').fill(ticket);
    await page.getByRole('button', { name: new RegExp(patient.last_name) }).first().click({ timeout: 20000 });
    await page.locator('#cashierdashboard-cash-tendered').fill('100000');
    await page.getByRole('button', { name: 'Take Payment', exact: true }).first().click();
    const final = page.getByRole('dialog');
    await final.getByRole('checkbox').first().check();
    await final.getByRole('button', { name: /^Take ₱/ }).click();
    const receipt = page.locator('.print-area').first();
    const gross = Number(first.price_at_time) + Number(second.price_at_time);
    await expect(receipt.getByText('Gross amount').locator('..')).toContainText(gross.toLocaleString('en-PH', { minimumFractionDigits: 2 }), { timeout: 20000 });
  });

  test('[1.161.0] someone early for a booking is offered it, not only a new visit', async ({ page }) => {
    const person = fixturePerson();
    const email = `second-walk-early-${Date.now()}@enlogada-e2e.test`;
    const { token } = await registerClient(ctx, { ...person, email, password: 'Password123!' });
    const profile = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token), data: { firstName: person.firstName, lastName: person.lastName, birthdate: '1991-09-19', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    expect(profile.patient_type_name ?? 'Self Pay', 'a patient is not asked').toBe('Self Pay');
    const date = nthWorkingDay(30);
    const slot = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(desk) })).json()).data.slots.find((s) => s.available);
    const booked = await ctx.post(`${API}/appointments`, {
      headers: auth(token),
      multipart: appointmentForm({ patientId: profile.id, scheduledDate: date, scheduledTime: slot.time, testIds: [lab[0].id] }, { doctorRequest: false }),
    });
    expect(booked.status(), await booked.text()).toBe(201);

    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    await page.getByRole('searchbox', { name: "Who's here?" }).fill(person.lastName);
    const match = page.getByTestId('desk-match').filter({ hasText: person.fullName }).first();
    await match.getByTestId('match-next-booking').click({ timeout: 20000 });
    await expect(page.getByTestId('booking-card')).toContainText(person.fullName);
    await expect(page.getByTestId('booking-other-day')).toBeVisible();
  });

  test('[1.161.0] an open portal keeps up with what the clinic did, with no Refresh', async ({ page }) => {
    test.setTimeout(90000);
    const person = fixturePerson();
    const email = `second-walk-open-${Date.now()}@enlogada-e2e.test`;
    const { token } = await registerClient(ctx, { ...person, email, password: 'Password123!' });
    const profile = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token), data: { firstName: person.firstName, lastName: person.lastName, birthdate: '1991-09-19', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const date = nthWorkingDay(31);
    const slot = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(desk) })).json()).data.slots.find((s) => s.available);
    const { appointment } = (await (await ctx.post(`${API}/appointments`, {
      headers: auth(token),
      multipart: appointmentForm({ patientId: profile.id, scheduledDate: date, scheduledTime: slot.time, testIds: [lab[0].id] }, { doctorRequest: false }),
    })).json()).data;

    await signIn(page, email, 'Password123!');
    const pay = page.locator(`[data-testid="portal-need"][data-need="pay-${appointment.id}"]`);
    await expect(pay).toBeVisible({ timeout: 20000 });

    const paid = await ctx.post(`${API}/payments`, {
      headers: auth(cashier), data: { patientVisitId: appointment.patient_visit_id, paymentMethod: 'Cash', amount: Number((await billOf(appointment.patient_visit_id)).totalAmount) },
    });
    expect(paid.status(), await paid.text()).toBe(201);

    await page.waitForTimeout(16000);
    await openPortalTab(page, 'appointments');
    await openPortalTab(page, 'home');
    await expect(pay, 'no longer told to pay what is paid').toHaveCount(0, { timeout: 15000 });
  });

  test('[1.161.0] sales by service still add up after a receipt is reversed and the visit re-billed at another price', async () => {
    const su = await loginAs(ctx, CREDS.superadmin);
    const pkg = (await (await ctx.get(`${API}/packages`)).json()).data.packages.find((p) => !p.name.startsWith('E2E '));
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: { patientTypeId: await patientTypeId(ctx, API, desk, 'Self Pay'), firstName: person.firstName, lastName: person.lastName, birthdate: '1985-06-20', sex: 'Female', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const visitId = (await (await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', packageIds: [pkg.id] } })).json()).data.visit.id;
    const [line] = await lines(visitId);
    const id = await idOf(await claim([line.id]));
    await approve(id);
    const pay = async () => ctx.post(`${API}/payments`, {
      headers: auth(cashier), data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: Number((await billOf(visitId)).totalAmount) },
    });
    const first = (await (await pay()).json()).data.payment;
    const back = await ctx.post(`${API}/payments/${first.id}/refund`, {
      headers: auth(su), data: { kind: 'recorded_by_mistake', reason: 'Recorded on the wrong visit', returnedVia: 'Cash' },
    });
    expect(back.status(), await back.text()).toBe(201);
    const row = (await (await ctx.get(`${API}/hmo/request/${id}`, { headers: auth(admin) })).json()).data.request.tests[0];
    await ctx.put(`${API}/hmo/request-test/${row.id}`, { headers: auth(admin), data: { approvalStatus: 'Rejected', decisionReason: REASON } });
    expect((await pay()).status()).toBe(201);

    const day = new Date();
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const { report } = (await (await ctx.get(`${API}/reports/operations`, { headers: auth(su), params: { startDate: date, endDate: date } })).json()).data;
    const summed = report.billing.byService.reduce((total, r) => total + Number(r.net), 0);
    expect(Math.abs(summed - Number(report.billing.totals.collected))).toBeLessThan(1);
  });

  test('[1.162.0] two cashiers on one visit, and two desks on one booking: one wins, and nothing is doubled', async () => {
    const second = await loginAs(ctx, { email: 'admin@enlogada.com', password: 'Password123!' });
    const { visitId } = await patientAndVisit();
    const body = { patientVisitId: visitId, paymentMethod: 'Cash', amount: Number((await billOf(visitId)).totalAmount) };
    const both = await Promise.all([
      ctx.post(`${API}/payments`, { headers: auth(cashier), data: body }),
      ctx.post(`${API}/payments`, { headers: auth(second), data: body }),
    ]);
    expect(both.map((r) => r.status()).sort()).toEqual([201, 409]);
    const receipts = (await (await ctx.get(`${API}/payments/visit/${visitId}`, { headers: auth(cashier) })).json()).data.payments;
    expect(receipts.filter((p) => p.payment_status === 'Paid')).toHaveLength(1);

    const made = await Promise.all([patientAndVisit(), patientAndVisit(), patientAndVisit()]);
    expect(new Set(made.map((m) => m.ticket)).size, 'no ticket handed out twice').toBe(3);
  });

  test('[1.162.0] one drawer per cashier: each counts their own, and the setting is SuperAdmin\'s', async () => {
    const su = await loginAs(ctx, CREDS.superadmin);
    const setMode = (mode, token = su) => ctx.put(`${API}/admin/settings/cash-drawers`, { headers: auth(token), data: { mode } });
    expect((await setMode('per_cashier', admin)).status(), 'not an Admin').toBe(403);
    expect((await setMode('three_drawers')).status()).toBe(400);
    const dayOf = async (token) => (await (await ctx.get(`${API}/cash-counts/day`, { headers: auth(token) })).json()).data;
    const shared = await dayOf(cashier);
    expect(shared.ownDrawer).toBe(false);

    expect((await setMode('per_cashier')).status()).toBe(200);
    try {
      const { visitId } = await patientAndVisit();
      const bill = await billOf(visitId);
      const beforeMine = await dayOf(cashier);
      const beforeTheirs = await dayOf(su);
      expect(beforeMine.ownDrawer).toBe(true);
      const paid = await ctx.post(`${API}/payments`, {
        headers: auth(cashier), data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: Number(bill.totalAmount) },
      });
      expect(paid.status(), await paid.text()).toBe(201);

      const mine = await dayOf(cashier);
      expect(money(mine.expected.cash - beforeMine.expected.cash), 'in the drawer of whoever took it').toBe(money(bill.totalAmount));
      expect(money((await dayOf(su)).expected.cash), 'and nobody else').toBe(money(beforeTheirs.expected.cash));

      const fund = 500;
      const counted = await ctx.post(`${API}/cash-counts`, {
        headers: auth(cashier),
        data: { changeFund: fund, pieces: {}, loose: mine.expected.cash + fund, note: 'Own drawer, counted by the spec' },
      });
      expect(counted.status(), await counted.text()).toBe(201);
      const after = (await counted.json()).data;
      expect(after.current.difference).toBe(0);
      expect(after.ownDrawer).toBe(true);
      expect((await dayOf(su)).current, "someone else's drawer is not counted").toBeFalsy();

      const list = (await (await ctx.get(`${API}/cash-counts`, { headers: auth(su), params: { limit: 100 } })).json()).data;
      const today = list.days.filter((d) => d.date === mine.date);
      expect(today.some((d) => d.drawerName && d.count), 'a row per cashier').toBe(true);
    } finally {
      expect((await setMode('shared')).status()).toBe(200);
    }
    expect((await dayOf(cashier)).ownDrawer).toBe(false);
  });

  test('[1.162.0] SuperAdmin finds the drawer setting beside the payment accounts, and an Admin does not', async ({ page }) => {
    await signInTo(page, 'admin@enlogada.com', 'Super Admin');
    await page.getByRole('tab', { name: 'Payment Methods', exact: true }).click();
    const panel = page.getByTestId('cash-drawers');
    await expect(panel.getByRole('radio', { name: /One shared drawer/ })).toBeChecked({ timeout: 15000 });
    await expect(panel.getByRole('button', { name: 'Save', exact: true }), 'nothing to save yet').toBeDisabled();
    await panel.getByRole('radio', { name: /One drawer per cashier/ }).check();
    await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    expect((await ctx.get(`${API}/admin/settings/cash-drawers`, { headers: auth(admin) })).status()).toBe(403);
  });

  test('[1.162.0] a record with nothing on it for 10 years is archived, not deleted; a recent one is left alone', async () => {
    const su = await loginAs(ctx, CREDS.superadmin);
    const fixture = async () => {
      const person = fixturePerson();
      return (await (await ctx.post(`${API}/patients`, {
        headers: auth(desk),
        data: { patientTypeId: await patientTypeId(ctx, API, desk, 'Self Pay'), firstName: person.firstName, lastName: person.lastName, birthdate: '1960-02-02', sex: 'Male', contactNumber: FIXTURE_CONTACT },
      })).json()).data.patient;
    };
    const [old, recent, nearly] = [await fixture(), await fixture(), await fixture()];
    runScript('e2eAgeRecord.js', [`--patient=${old.id}`, '--years=11'], 'age record');
    runScript('e2eAgeRecord.js', [`--patient=${nearly.id}`, '--years=9'], 'age record');
    const swept = JSON.parse(runScript('e2eAgeRecord.js', ['--sweep'], 'archive sweep').trim().split('\n').pop());
    expect(swept).toContain(old.id);
    expect(swept).not.toContain(recent.id);
    expect(swept, 'nine years is not ten').not.toContain(nearly.id);

    const read = (id) => ctx.get(`${API}/patients/${id}`, { headers: auth(su) });
    expect((await read(old.id)).status(), 'still there').toBe(200);
    expect((await (await read(old.id)).json()).data.patient.archived_at).toBeTruthy();
    const log = await (await ctx.get(`${API}/admin/activity`, { headers: auth(su), params: { limit: 20 } })).text();
    expect(log).toContain('Nothing was deleted');

    // Restored by a person, it is not taken straight back.
    expect((await ctx.patch(`${API}/patients/${old.id}/archive`, { headers: auth(su), data: { archived: false } })).status()).toBe(200);
    expect(JSON.parse(runScript('e2eAgeRecord.js', ['--sweep'], 'archive sweep').trim().split('\n').pop())).not.toContain(old.id);
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
