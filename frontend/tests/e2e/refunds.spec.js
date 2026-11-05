// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';
import { appointmentForm, bookableTestId } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { pdfReport } from './helpers/reportFile.js';
import { PNG } from './helpers/payments.js';

/**
 * A paid receipt is final, with two recorded exceptions. [1.155.0]
 *
 * [1.121.0] removed refunds because one person could take money and hand it back alone, a refunded
 * receipt still read as paid, only a whole receipt could be reversed, and nothing recorded how the money
 * went back. Steven reopened it for the two cases "final" could not answer: the clinic cannot do a test
 * it took money for, and a payment recorded by mistake. So this holds the four answers as well as the two
 * cases, and that a patient's change of mind is still on neither list.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';
const CANNOT = 'clinic_cannot_perform';
const MISTAKE = 'recorded_by_mistake';

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.describe('Refunds [1.155.0]', () => {
  let ctx;
  let cashier, reception, superAdmin, admin, lab;
  let tests;
  let labA, labB, ultrasound;

  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [cashier, reception, superAdmin, admin, lab] = await Promise.all(
      ['cashier@enlogada.com', 'receptionist@enlogada.com', 'admin@enlogada.com', 'clinicadmin@enlogada.com', 'lab@enlogada.com'].map(login)
    );
    tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
    const labs = tests.filter((t) => t.category_name === 'Laboratory' && t.is_active);
    [labA, labB] = labs;
    ultrasound = tests.find((t) => t.category_name === 'Ultrasound' && t.is_active);
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  async function walkIn(testIds, over = {}) {
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
        ...fixturePerson(), birthdate: '1979-02-02', sex: 'Male', contactNumber: FIXTURE_CONTACT, ...over,
      },
    })).json()).data.patient;
    const created = await ctx.post(`${API}/visits`, {
      headers: auth(reception), data: { patientId: patient.id, visitType: 'Walk in', testIds },
    });
    expect(created.status(), await created.text()).toBe(201);
    return { patient, visit: (await created.json()).data.visit };
  }

  const billOf = async (visitId) => (await (await ctx.get(`${API}/payments/bill/${visitId}`, { headers: auth(cashier) })).json()).data.bill;

  async function pay(visitId, over = {}, token = cashier) {
    const bill = await billOf(visitId);
    const res = await ctx.post(`${API}/payments`, {
      headers: auth(token), data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: Number(bill.totalAmount), ...over },
    });
    expect(res.status(), await res.text()).toBe(201);
    return { payment: (await res.json()).data.payment, bill };
  }

  /** A walk-in paid in cash. */
  async function paidWalkIn(testIds, over) {
    const { patient, visit } = await walkIn(testIds, over);
    const { payment, bill } = await pay(visit.id);
    return { patient, visit, payment, bill };
  }

  const options = async (paymentId, token = superAdmin) => (await (await ctx.get(`${API}/payments/${paymentId}/refund`, { headers: auth(token) })).json()).data;
  const refund = (paymentId, body, token = superAdmin) => ctx.post(`${API}/payments/${paymentId}/refund`, {
    headers: auth(token),
    data: { reason: 'The analyser is down until next week.', returnedVia: 'Cash', ...body },
  });
  const paymentNow = async (visitId) => (await (await ctx.get(`${API}/payments/visit/${visitId}`, { headers: auth(cashier) })).json()).data.payments[0];
  const summaryToday = async () => {
    const d = today();
    return (await (await ctx.get(`${API}/payments/transactions`, {
      headers: auth(cashier), params: { startDate: d, endDate: d, page: 1, limit: 1 },
    })).json()).data.summary;
  };

  /** Attach and release a report for one test on a paid visit. */
  async function releaseReport(visitId, categoryName = 'Laboratory', token = lab) {
    const rows = (await (await ctx.get(`${API}/results/pending/${categoryName}?limit=500`, { headers: auth(token) })).json()).data.pending;
    const row = rows.find((r) => r.visit_id === visitId);
    const saved = await ctx.post(`${API}/results/${row.visit_test_id}`, {
      headers: auth(token), multipart: { file: { name: 'report.pdf', mimeType: 'application/pdf', buffer: pdfReport('Report') } },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    expect((await ctx.post(`${API}/results/${row.visit_test_id}/release`, { headers: auth(token) })).status()).toBe(200);
    return row.visit_test_id;
  }

  test('the old way stays gone, and only the SuperAdmin can reach the new one', async () => {
    const { payment } = await paidWalkIn([labA.id]);
    for (const token of [cashier, admin]) {
      expect((await ctx.patch(`${API}/payments/${payment.id}/status`, { headers: auth(token), data: { status: 'Refunded' } })).status(), 'the old route').toBe(404);
      expect((await ctx.get(`${API}/payments/${payment.id}/refund`, { headers: auth(token) })).status()).toBe(403);
      expect((await refund(payment.id, { kind: MISTAKE }, token)).status()).toBe(403);
    }
    const matrix = (await (await ctx.get(`${API}/rbac/matrix`, { headers: auth(superAdmin) })).json()).data;
    expect(matrix.permissions.map((p) => p.name), 'and it cannot be granted on the grid').not.toContain('billing:refund');
    expect((await ctx.post(`${API}/payments/${payment.id}/refund`, { data: {} })).status(), 'no token').toBe(401);
  });

  test('a refund has to say why, how the money goes back, and which test', async () => {
    const { payment } = await paidWalkIn([labA.id]);
    const line = (await options(payment.id)).tests[0];
    expect((await refund(payment.id, { kind: 'changed_my_mind', testIds: [line.id] })).status(), 'a change of mind is not a reason').toBe(400);
    expect((await refund(payment.id, { kind: CANNOT, testIds: [line.id], reason: '   ' })).status()).toBe(400);
    expect((await refund(payment.id, { kind: CANNOT, testIds: [] })).status()).toBe(400);
    expect((await refund(payment.id, { kind: CANNOT, testIds: [99999999] })).status()).toBe(400);
    expect((await refund(payment.id, { kind: CANNOT, testIds: [line.id], returnedVia: 'PayMaya' })).status()).toBe(400);
    expect((await refund(payment.id, { kind: CANNOT, testIds: [line.id], returnedVia: 'GCash' })).status(), 'GCash, no reference').toBe(400);
    expect((await refund(99999999, { kind: MISTAKE })).status()).toBe(404);
    expect((await refund('abc', { kind: MISTAKE })).status()).toBe(400);
    expect((await options(payment.id)).refunded, 'nothing happened').toBe(0);
  });

  test('nobody refunds a receipt they took themselves', async () => {
    const { visit } = await walkIn([labA.id]);
    const { payment } = await pay(visit.id, {}, superAdmin);
    expect((await options(payment.id)).blocked).toMatch(/someone else/i);
    const res = await refund(payment.id, { kind: MISTAKE });
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toMatch(/someone else/i);
  });

  test('one test the clinic cannot do: that test goes, the rest carry on, and the books show it', async () => {
    const before = await summaryToday();
    const { visit, payment } = await paidWalkIn([labA.id, ultrasound.id], {});
    const opts = await options(payment.id);
    const line = opts.tests.find((t) => t.name === labA.name);
    const other = opts.tests.find((t) => t.name === ultrasound.name);
    expect(line.amount + other.amount, 'the shares are the receipt').toBeCloseTo(Number(payment.amount), 2);

    const res = await refund(payment.id, { kind: CANNOT, testIds: [line.id] });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()).data;
    expect(body.amount).toBeCloseTo(line.amount, 2);

    const after = await paymentNow(visit.id);
    expect(after.payment_status, 'still paid, for the rest').toBe('Paid');

    const rows = (await (await ctx.get(`${API}/results/pending/Laboratory?limit=500`, { headers: auth(lab) })).json()).data.pending;
    expect(rows.find((r) => r.visit_id === visit.id), 'gone from its worklist').toBeUndefined();
    const usRows = (await (await ctx.get(`${API}/results/pending/Ultrasound?limit=500`, { headers: auth(await login('ultrasound@enlogada.com')) })).json()).data.pending;
    expect(usRows.find((r) => r.visit_id === visit.id), 'the other still with its department').toBeTruthy();

    const s = await summaryToday();
    expect(Number(s.reversed) - Number(before.reversed)).toBeCloseTo(line.amount, 2);
    expect(Number(s.collected) - Number(before.collected), 'what was taken is never restated').toBeCloseTo(Number(payment.amount), 2);

    const again = await refund(payment.id, { kind: CANNOT, testIds: [line.id] });
    expect(again.status(), 'a test is refunded once').toBe(409);

    const feed = (await (await ctx.get(`${API}/admin/activity`, { headers: auth(superAdmin), params: { limit: 30 } })).json()).data.entries;
    expect(feed.some((e) => e.action === 'payment.refunded' && String(e.entity_id) === String(payment.id)), 'in the Activity Log').toBe(true);
  });

  test('with a discount it gives back what was paid, never the list price', async () => {
    const { patient, visit } = await walkIn([labA.id, labB.id]);
    const pwd = (await (await ctx.get(`${API}/discounts`, { headers: auth(cashier) })).json()).data.discounts.find((d) => d.name === 'PWD');
    expect((await ctx.post(`${API}/discounts/visit/${visit.id}`, { headers: auth(cashier), data: { discountTypeId: pwd.id, idNumber: 'PWD-10-1111-222' } })).status()).toBe(200);
    expect(patient).toBeTruthy();
    const { payment } = await pay(visit.id);
    const opts = await options(payment.id);
    const line = opts.tests[0];
    const listPrice = Number(tests.find((t) => t.name === line.name).price);
    expect(line.amount, 'less than the list price').toBeLessThan(listPrice);
    expect(opts.tests.reduce((s, t) => s + t.amount, 0)).toBeCloseTo(Number(payment.amount), 2);
  });

  test('every test refunded: the visit ends, the receipt reads Refunded, and no more can come back', async () => {
    const { visit, payment } = await paidWalkIn([labA.id, labB.id]);
    const [a, b] = (await options(payment.id)).tests;
    expect((await refund(payment.id, { kind: CANNOT, testIds: [a.id] })).status()).toBe(201);
    expect((await paymentNow(visit.id)).payment_status).toBe('Paid');
    expect((await refund(payment.id, { kind: CANNOT, testIds: [b.id] })).status()).toBe(201);

    const after = await paymentNow(visit.id);
    expect(after.payment_status).toBe('Refunded');
    expect((await refund(payment.id, { kind: CANNOT, testIds: [a.id] })).status(), 'nothing left').toBe(409);
    const receipt = (await (await ctx.get(`${API}/payments/receipt/${payment.receipt_number}`, { headers: auth(cashier) })).json()).data.payment;
    expect(Number(receipt.refunded_amount)).toBeCloseTo(Number(payment.amount), 2);
    expect(receipt.refunds).toHaveLength(2);
    const v = (await (await ctx.get(`${API}/visits/${visit.id}`, { headers: auth(reception) })).json()).data.visit;
    expect(v.status).toBe('Cancelled');
  });

  test('a test already done cannot be refunded; the one left can, and that finishes the visit', async () => {
    const { visit, payment } = await paidWalkIn([labA.id, ultrasound.id]);
    const done = await releaseReport(visit.id);
    const opts = await options(payment.id);
    expect(opts.tests.find((t) => t.id === done).whyNot).toMatch(/released/i);
    const refused = await refund(payment.id, { kind: CANNOT, testIds: [done] });
    expect(refused.status()).toBe(409);
    expect((await refund(payment.id, { kind: MISTAKE })).status(), 'and the whole receipt cannot go back').toBe(409);

    const other = opts.tests.find((t) => t.id !== done);
    expect((await refund(payment.id, { kind: CANNOT, testIds: [other.id] })).status()).toBe(201);
    const v = (await (await ctx.get(`${API}/visits/${visit.id}`, { headers: auth(reception) })).json()).data.visit;
    expect(v.status, 'nothing is left to wait for').toBe('Completed');
    expect((await paymentNow(visit.id)).payment_status, 'the money for the done test stands').toBe('Paid');
  });

  test('recorded by mistake: the whole receipt goes back, the visit owes again, and the right payment can be taken', async () => {
    const { visit, payment } = await paidWalkIn([labA.id]);
    const rowsBefore = (await (await ctx.get(`${API}/results/pending/Laboratory?limit=500`, { headers: auth(lab) })).json()).data.pending;
    expect(rowsBefore.find((r) => r.visit_id === visit.id), 'released to the lab by the payment').toBeTruthy();

    const res = await refund(payment.id, { kind: MISTAKE, reason: 'Charged to the wrong patient.' });
    expect(res.status(), await res.text()).toBe(201);
    expect((await paymentNow(visit.id)).payment_status).toBe('Refunded');
    const rows = (await (await ctx.get(`${API}/results/pending/Laboratory?limit=500`, { headers: auth(lab) })).json()).data.pending;
    expect(rows.find((r) => r.visit_id === visit.id), 'back off the worklist until it is paid').toBeUndefined();

    const { payment: second } = await pay(visit.id);
    expect(second.receipt_number, 'a new receipt, not the old one').not.toBe(payment.receipt_number);
    const rowsAfter = (await (await ctx.get(`${API}/results/pending/Laboratory?limit=500`, { headers: auth(lab) })).json()).data.pending;
    expect(rowsAfter.find((r) => r.visit_id === visit.id), 'and it goes to the lab again').toBeTruthy();
  });

  test('the drawer answers to how the money went back, not how it came in', async () => {
    const d = today();
    const expected = async () => Number((await (await ctx.get(`${API}/cash-counts/day`, { headers: auth(cashier), params: { date: d } })).json()).data.expected.cash);
    const { visit } = await walkIn([labA.id]);
    const { payment } = await pay(visit.id, { paymentMethod: 'GCash', referenceNumber: `GC${Date.now()}` });
    const before = await expected();
    expect((await refund(payment.id, { kind: MISTAKE, returnedVia: 'Cash' })).status()).toBe(201);
    expect(before - await expected(), 'cash left the drawer').toBeCloseTo(Number(payment.amount), 2);
  });

  test("a reference freed by a mistake's refund can pay the right booking", async () => {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const profile = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, token, 'Self Pay'), firstName: person.firstName, lastName: person.lastName,
        birthdate: '1990-03-14', sex: 'Female', address: 'Bugo', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const method = (await (await ctx.get(`${API}/payment-methods`)).json()).data.methods[0];
    const bookOne = async (offset) => {
      const date = nthWorkingDay(60 + (Date.now() % 20) + offset);
      const free = (await (await ctx.get(`${API}/appointments/availability`, { headers: auth(token), params: { date } })).json()).data.slots.filter((s) => s.available);
      const res = await ctx.post(`${API}/appointments`, {
        headers: auth(token),
        multipart: appointmentForm({ patientId: profile.id, scheduledDate: date, scheduledTime: free[0].time, testIds: [await bookableTestId(ctx)] }, { doctorRequest: false }),
      });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).data.appointment;
    };
    const proof = (visitId, reference) => ctx.post(`${API}/payment-submissions`, {
      headers: auth(token),
      multipart: {
        patientVisitId: String(visitId), paymentMethodId: String(method.id), referenceNumber: reference,
        proof: { name: 'receipt.png', mimeType: 'image/png', buffer: PNG },
      },
    });
    const reference = `GC${Date.now()}`;
    const wrong = await bookOne(0);
    const right = await bookOne(1);
    const sent = await proof(wrong.patient_visit_id, reference);
    const verified = await ctx.post(`${API}/payment-submissions/${(await sent.json()).data.submission.id}/verify`, { headers: auth(cashier), data: {} });
    expect(verified.status()).toBe(200);
    expect((await proof(right.patient_visit_id, reference)).status(), 'one transfer, one booking').toBe(409);

    const paymentId = (await verified.json()).data.payment.id;
    expect((await refund(paymentId, { kind: MISTAKE, reason: 'Verified against the wrong booking.' })).status()).toBe(201);
    expect((await proof(right.patient_visit_id, reference)).status(), 'free again').toBe(201);

    // The patient can see what happened and why.
    const mine = (await (await ctx.get(`${API}/payments/my-payments`, { headers: auth(token) })).json()).data;
    const row = (mine.payments || mine).find((p) => p.id === paymentId);
    expect(row.payment_status).toBe('Refunded');
    expect(row.refunds[0].reason).toContain('wrong booking');
  });

  test('a booking with every test refunded gives its time back', async () => {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const profile = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, token, 'Self Pay'), firstName: person.firstName, lastName: person.lastName,
        birthdate: '1990-03-14', sex: 'Female', address: 'Bugo', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const date = nthWorkingDay(85 + (Date.now() % 20));
    const free = (await (await ctx.get(`${API}/appointments/availability`, { headers: auth(token), params: { date } })).json()).data.slots.filter((s) => s.available);
    const time = free[0].time;
    const created = await ctx.post(`${API}/appointments`, {
      headers: auth(token),
      multipart: appointmentForm({ patientId: profile.id, scheduledDate: date, scheduledTime: time, testIds: [labA.id] }, { doctorRequest: false }),
    });
    const appt = (await created.json()).data.appointment;
    const { payment } = await pay(appt.patient_visit_id);
    const line = (await options(payment.id)).tests[0];
    expect((await refund(payment.id, { kind: CANNOT, testIds: [line.id], reason: 'The analyser cannot be repaired by then.' })).status()).toBe(201);
    const slot = (await (await ctx.get(`${API}/appointments/availability`, { headers: auth(token), params: { date } })).json()).data.slots.find((s) => s.time === time);
    expect(slot.available, 'back on offer').toBe(true);
  });

  test('a test the HMO covered has nothing to give back', async () => {
    const provider = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(reception) })).json()).data.providers[0];
    const { visit } = await walkIn([labA.id, labB.id], { });
    const vts = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json()).data;
    const lines = vts.visitTests || vts.tests || vts;
    const claim = await ctx.post(`${API}/hmo/request`, {
      headers: auth(reception),
      data: { hmoProviderId: provider.id, approvalCode: 'LOA-5', visitTestIds: [lines[0].id ?? lines[0].visit_test_id], referringPhysician: 'Dr. Ana Ybañez' },
    });
    expect(claim.status(), await claim.text()).toBe(201);
    const request_ = (await claim.json()).data;
    const claimId = (request_.request || request_.hmoRequest || request_).id;
    expect((await ctx.put(`${API}/hmo/request/${claimId}/approve`, { headers: auth(admin), data: { approvalCode: 'LOA-5' } })).status()).toBe(200);
    const { payment } = await pay(visit.id);
    const opts = await options(payment.id);
    const covered = opts.tests.find((t) => t.hmoApproved);
    expect(covered.amount).toBe(0);
    expect(covered.whyNot).toMatch(/HMO/);
    expect(opts.tests.find((t) => !t.hmoApproved).amount).toBeCloseTo(Number(payment.amount), 2);
  });

  // ── On screen ───────────────────────────────────────────────────────────────────────────────

  test("the cashier's receipt log offers no Refund", async ({ page }) => {
    await paidWalkIn([labA.id]);
    await signInTo(page, 'cashier@enlogada.com', 'Transaction History');
    await expect(page.getByRole('button', { name: 'Reprint' }).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('refund-open')).toHaveCount(0);
  });

  test('an Admin sees the receipts and cannot refund them', async ({ page }) => {
    await paidWalkIn([labA.id]);
    await signInTo(page, 'clinicadmin@enlogada.com', 'Cashier Monitoring');
    await expect(page.getByRole('button', { name: 'Open' }).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('refund-open')).toHaveCount(0);
  });

  test('the SuperAdmin refunds on screen: it says what it will do, and the receipt says what it did', async ({ page, context }) => {
    const { payment } = await paidWalkIn([labA.id]);
    await signInTo(page, 'admin@enlogada.com', 'Cashier Monitoring');
    const row = page.getByRole('row').filter({ hasText: payment.receipt_number });
    await row.getByTestId('refund-open').click({ timeout: 20000 });
    const dialog = page.getByTestId('refund-dialog');
    await expect(dialog).toBeVisible();

    const confirm = dialog.getByTestId('refund-confirm');
    await expect(confirm, 'not until it says why').toBeDisabled();
    await dialog.getByLabel('The payment was recorded by mistake').check();
    await expect(dialog.getByText(/the visit owes again/i)).toBeVisible();
    await dialog.locator('#refund-reason').fill('Charged to the wrong patient.');
    await expect(confirm).toBeEnabled();
    await expect(confirm).toContainText('Refund');
    await confirm.click();
    await expect(page.getByText(/refunded from receipt/i)).toBeVisible({ timeout: 15000 });

    const receipt = await context.newPage();
    await receipt.goto(`/?receipt=${encodeURIComponent(payment.receipt_number)}`);
    await expect(receipt.getByTestId('receipt-refunded'), 'it no longer reads as a valid paid receipt').toBeVisible({ timeout: 20000 });
    await expect(receipt.getByTestId('receipt-refunds')).toContainText('wrong patient');
  });

  test('the patient sees the refund on Payments', async ({ page }) => {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const profile = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, token, 'Self Pay'), firstName: person.firstName, lastName: person.lastName,
        birthdate: '1990-03-14', sex: 'Female', address: 'Bugo', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    const date = nthWorkingDay(110 + (Date.now() % 15));
    const free = (await (await ctx.get(`${API}/appointments/availability`, { headers: auth(token), params: { date } })).json()).data.slots.filter((s) => s.available);
    const created = await ctx.post(`${API}/appointments`, {
      headers: auth(token),
      multipart: appointmentForm({ patientId: profile.id, scheduledDate: date, scheduledTime: free[0].time, testIds: [labA.id, labB.id] }, { doctorRequest: false }),
    });
    const appt = (await created.json()).data.appointment;
    const { payment } = await pay(appt.patient_visit_id);
    const line = (await options(payment.id)).tests[0];
    expect((await refund(payment.id, { kind: CANNOT, testIds: [line.id], reason: 'The analyser is down.' })).status()).toBe(201);

    await signIn(page, email, PASSWORD);
    await openPortalTab(page, 'payments');
    await expect(page.getByTestId('payment-refund')).toContainText('The analyser is down.');
  });

  test('a paid visit still says to start another visit', async () => {
    const { visit } = await paidWalkIn([labA.id]);
    const res = await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(reception), data: { patientVisitId: visit.id, testIds: [labB.id] },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toContain('Start another visit');
  });
});
