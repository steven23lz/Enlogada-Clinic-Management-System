// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo } from './helpers/auth.js';
import { openPortalTab, openBooking, attachDoctorRequest } from './helpers/portal.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { appointmentForm } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { PNG, ensureMethod } from './helpers/payments.js';
import { pdfReport } from './helpers/reportFile.js';

/**
 * Each role, on the screen, when the connection drops or the person does something odd. [1.171.0]
 *
 * Steven: "before submitting the payment verification and get cut off like no internet... trying to
 * stop booking... be QA and a tester at the same time". Two kinds of cut, because they need opposite
 * answers:
 *   offline     the request never left: nothing was saved, so the person must try again.
 *   reply lost  the clinic saved it and only the answer went missing: the person must NOT be told it
 *               failed, or they pay twice, register twice, or stop trusting the screen.
 * Measured before [1.171.0]: a payment the till had taken read "Couldn't process payment", a walk-in
 * registered read "Couldn't register walk-in patient" and then asked to use the record on file, which
 * could only fail. Each test below states what the person sees and what the clinic holds afterwards.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

/** The next write to `url` is cut: before it leaves ('offline'), or after the clinic answered ('replyLost'). */
async function cut(page, url, mode) {
  await page.route(url, async (route) => {
    if (route.request().method() === 'GET') return route.continue();
    if (mode === 'replyLost') await route.fetch();
    return route.abort('connectionreset');
  }, { times: 1 });
}

test.describe('When the connection drops [1.171.0]', () => {
  let ctx, superAdmin, desk, till, lab, method, usTest, labTest;
  const login = async (e) => (await (await ctx.post(`${API}/auth/login`, { data: { email: e, password: PASSWORD } })).json()).data.token;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [superAdmin, desk, till, lab] = await Promise.all(
      ['admin@enlogada.com', 'receptionist@enlogada.com', 'multirole@enlogada.com', 'lab@enlogada.com'].map(login)
    );
    method = await ensureMethod(ctx, superAdmin);
    const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
    usTest = tests.find((t) => t.category_name === 'Ultrasound' && t.is_active);
    labTest = tests.find((t) => t.category_name === 'Laboratory' && t.is_active);
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  const newPatientAccount = async () => {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1990-01-01', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    return { email, token, patient };
  };
  const withBooking = async (dayNumber) => {
    const p = await newPatientAccount();
    const res = await ctx.post(`${API}/appointments`, {
      headers: auth(p.token),
      multipart: appointmentForm({ patientId: p.patient.id, scheduledDate: nthWorkingDay(dayNumber), scheduledTime: '09:00', testIds: [usTest.id] }),
    });
    expect(res.status(), await res.text()).toBe(201);
    return { ...p, appt: (await res.json()).data.appointment };
  };
  const walkIn = async (testId = usTest.id) => {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: { patientTypeId: await patientTypeId(ctx, API, desk), ...person, birthdate: '1980-04-04', sex: 'Female', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const visit = (await (await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', testIds: [testId] } })).json()).data.visit;
    return { person, patient, visit };
  };
  const proofsOn = async (token, visitId) => (await (await ctx.get(`${API}/payment-submissions/visit/${visitId}`, { headers: auth(token) })).json()).data.submissions;
  const receiptsOn = async (visitId) => (await (await ctx.get(`${API}/payments/visit/${visitId}`, { headers: auth(till) })).json()).data.payments
    .filter((p) => p.payment_status === 'Paid');
  const bookingsOf = async (token) => (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(token) })).json()).data.bookings;

  // ── The patient ────────────────────────────────────────────────────────────────────────────

  test.describe('the patient', () => {
    const fillProof = async (page, visitId, reference) => {
      await openPortalTab(page, 'appointments');
      await page.getByTestId('final-tests-check').first().getByRole('checkbox', { name: 'These are the tests I want.' }).check();
      await page.getByLabel('Reference number').first().fill(reference);
      await page.locator(`#proof-${visitId}`).setInputFiles({ name: 'gcash.png', mimeType: 'image/png', buffer: PNG });
    };

    test('internet off as the payment proof is sent: told it was not sent, what they typed is kept, and sending again works once', async ({ page }) => {
      const p = await withBooking(247);
      const reference = `OFF${Date.now()}`;
      await signIn(page, p.email, PASSWORD);
      await fillProof(page, p.appt.patient_visit_id, reference);
      await cut(page, '**/api/payment-submissions', 'offline');
      await page.getByRole('button', { name: 'Send for verification' }).click();

      await expect(page.getByRole('alert').filter({ hasText: /couldn't reach the clinic/i })).toBeVisible({ timeout: 10000 });
      await expect(page.getByLabel('Reference number').first()).toHaveValue(reference);
      expect(await proofsOn(p.token, p.appt.patient_visit_id), 'nothing reached the clinic').toHaveLength(0);

      await page.getByRole('button', { name: 'Send for verification' }).click();
      await expect(page.getByText('Payment sent for checking').first()).toBeVisible({ timeout: 15000 });
      expect(await proofsOn(p.token, p.appt.patient_visit_id)).toHaveLength(1);
    });

    test('the proof reaches the clinic but the reply is lost: the patient sees it was received, never "try again"', async ({ page }) => {
      const p = await withBooking(248);
      await signIn(page, p.email, PASSWORD);
      await fillProof(page, p.appt.patient_visit_id, `LOST${Date.now()}`);
      await cut(page, '**/api/payment-submissions', 'replyLost');
      await page.getByRole('button', { name: 'Send for verification' }).click();

      await expect(page.getByText('Payment sent for checking').first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('alert').filter({ hasText: /could not be submitted|try again/i })).toHaveCount(0);
      expect(await proofsOn(p.token, p.appt.patient_visit_id), 'one proof, not two').toHaveLength(1);
    });

    const startBooking = async (page, dayNumber) => {
      const dialog = await openBooking(page);
      await dialog.locator('#slotpicker-label').fill(nthWorkingDay(dayNumber));
      await dialog.locator('[data-testid^="slot-"]').first().click({ timeout: 15000 });
      await dialog.getByRole('checkbox').first().check();
      return dialog;
    };

    test('the booking reaches the clinic but the reply is lost: Submit again shows the same booking, not a second', async ({ page }) => {
      const p = await newPatientAccount();
      await signIn(page, p.email, PASSWORD);
      const dialog = await startBooking(page, 249);
      await attachDoctorRequest(dialog);
      await cut(page, '**/api/appointments', 'replyLost');
      await dialog.getByRole('button', { name: /submit schedule request/i }).click();
      await expect(dialog.getByRole('alert').filter({ hasText: /couldn't reach the clinic/i })).toBeVisible({ timeout: 10000 });

      await dialog.getByRole('button', { name: /submit schedule request/i }).click();
      await expect(dialog.getByText(/APT-[A-Z0-9]+/).first()).toBeVisible({ timeout: 20000 });
      expect(await bookingsOf(p.token), 'one booking').toHaveLength(1);
    });

    test('Submit tapped twice: one booking', async ({ page }) => {
      const p = await newPatientAccount();
      await signIn(page, p.email, PASSWORD);
      const dialog = await startBooking(page, 250);
      await attachDoctorRequest(dialog);
      const submit = dialog.getByRole('button', { name: /submit schedule request/i });
      await submit.dblclick();
      await expect(dialog.getByText(/APT-[A-Z0-9]+/).first()).toBeVisible({ timeout: 20000 });
      expect(await bookingsOf(p.token)).toHaveLength(1);
    });

    test('a booking abandoned halfway, by a refresh or by closing it, books nothing', async ({ page }) => {
      const p = await newPatientAccount();
      await signIn(page, p.email, PASSWORD);
      await startBooking(page, 251);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Book a visit' }).first()).toBeVisible({ timeout: 20000 });

      const dialog = await startBooking(page, 251);
      await attachDoctorRequest(dialog);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      expect(await bookingsOf(p.token), 'nothing was booked').toHaveLength(0);
    });
  });

  // ── The front desk ─────────────────────────────────────────────────────────────────────────

  test.describe('the front desk', () => {
    const fillWalkIn = async (page, surname) => {
      await page.getByRole('button', { name: 'Register Walk-In', exact: true }).click();
      await page.getByPlaceholder('Juan', { exact: true }).fill('Lorna');
      await page.getByPlaceholder('Dela Cruz', { exact: true }).fill(surname);
      await page.locator('input[type="date"]:visible').first().fill('1988-05-12');
      await page.getByRole('combobox').filter({ hasText: /select patient type|patient type/i }).first().click();
      await page.getByRole('option', { name: 'Self Pay', exact: true }).click();
      await page.locator('form .overflow-y-auto input[type="checkbox"]:visible').first().check();
    };
    const recordsNamed = async (surname) => (await (await ctx.get(`${API}/patients/search?q=${surname}`, { headers: auth(desk) })).json()).data.patients;

    test('a walk-in registered but the reply lost: Register again says they are already in the queue, and nothing is doubled', async ({ page }) => {
      const surname = `Abellana${Date.now() % 100000}`;
      await signInTo(page, 'receptionist@enlogada.com', 'Desk');
      await fillWalkIn(page, surname);
      await cut(page, '**/api/visits', 'replyLost');
      await page.getByRole('button', { name: 'Register Walk-In & Issue Queue Ticket' }).click();
      await expect(page.getByRole('alert').filter({ hasText: /may already be registered/i })).toBeVisible({ timeout: 10000 });

      await page.getByRole('button', { name: 'Register Walk-In & Issue Queue Ticket' }).click();
      const told = page.getByTestId('already-waiting');
      await expect(told).toBeVisible({ timeout: 10000 });
      await expect(told).toContainText(/already in today's queue with ticket/i);
      expect(await recordsNamed(surname), 'one record').toHaveLength(1);
      await told.getByRole('button', { name: 'Done' }).click();
      await expect(told).toBeHidden();
    });

    test('Register tapped twice: one patient, one visit', async ({ page }) => {
      const surname = `Pacana${Date.now() % 100000}`;
      await signInTo(page, 'receptionist@enlogada.com', 'Desk');
      await fillWalkIn(page, surname);
      const register = page.getByRole('button', { name: 'Register Walk-In & Issue Queue Ticket' });
      await register.dblclick();
      await expect(page.getByText(/Queue ticket: /i).first()).toBeVisible({ timeout: 20000 });
      expect(await recordsNamed(surname)).toHaveLength(1);
    });
  });

  // ── The till ───────────────────────────────────────────────────────────────────────────────

  test.describe('the till', () => {
    const openTake = async (page, person) => {
      await page.getByPlaceholder('Search ticket # or name...').fill(person.lastName);
      await page.getByRole('button', { name: new RegExp(`${person.firstName} ${person.lastName}`) }).first().click({ timeout: 20000 });
      await page.locator('#cashierdashboard-cash-tendered').fill('100000');
      await page.getByRole('button', { name: 'Take Payment', exact: true }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Are these the final tests?' });
      await dialog.getByRole('checkbox', { name: 'The patient has confirmed these are their final tests.' }).check();
      return dialog;
    };

    test('the money is taken but the reply is lost: the cashier sees the receipt, not an error', async ({ page }) => {
      const { person, visit } = await walkIn();
      await signInTo(page, 'multirole@enlogada.com', 'Billing Queue');
      const dialog = await openTake(page, person);
      await cut(page, '**/api/payments', 'replyLost');
      await dialog.getByRole('button', { name: /^Take ₱/ }).click();
      await expect(page.getByText(/RCT-/).first(), 'the receipt is shown').toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('alert').filter({ hasText: /couldn.t process payment/i })).toHaveCount(0);
      expect(await receiptsOn(visit.id), 'one receipt').toHaveLength(1);
    });

    test('internet off as payment is taken: told it may not have gone through, and taking it again charges once', async ({ page }) => {
      const { person, visit } = await walkIn();
      await signInTo(page, 'multirole@enlogada.com', 'Billing Queue');
      const dialog = await openTake(page, person);
      await cut(page, '**/api/payments', 'offline');
      await dialog.getByRole('button', { name: /^Take ₱/ }).click();
      await expect(page.getByRole('alert').filter({ hasText: /connection dropped/i })).toBeVisible({ timeout: 15000 });
      expect(await receiptsOn(visit.id), 'nothing taken').toHaveLength(0);

      const again = await openTake(page, person);
      await again.getByRole('button', { name: /^Take ₱/ }).click();
      await expect(page.getByText(/RCT-/).first()).toBeVisible({ timeout: 15000 });
      expect(await receiptsOn(visit.id)).toHaveLength(1);
    });
  });

  // ── A department ───────────────────────────────────────────────────────────────────────────

  test.describe('a department', () => {
    test('a report released but the reply lost: released once, and the worklist moves on', async ({ page }) => {
      const { patient, visit } = await walkIn(labTest.id);
      const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth(till) })).json()).data.bill;
      expect((await ctx.post(`${API}/payments`, { headers: auth(till), data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: Number(bill.totalAmount) } })).status()).toBe(201);

      await signInTo(page, 'lab@enlogada.com', 'Laboratory Worklist');
      await page.getByPlaceholder('Search patient, test, queue...').fill(patient.last_name);
      const row = page.getByText(`${patient.first_name} ${patient.last_name}`).locator('xpath=ancestor::tr[1]');
      await row.getByRole('button', { name: 'Attach Report' }).click({ timeout: 15000 });
      await page.locator('input[type="file"]').setInputFiles({ name: 'cbc.pdf', mimeType: 'application/pdf', buffer: pdfReport('lab') });
      await page.getByRole('button', { name: 'Authorize & Release Result' }).click();
      await cut(page, '**/release', 'replyLost');
      await page.getByRole('button', { name: 'Authorize & Release', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: /couldn.t release/i }), 'never "could not release" over a released report').toHaveCount(0);
      const [line] = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(desk) })).json()).data.visitTests;
      const releasedCount = async () => {
        const versions = (await (await ctx.get(`${API}/results/${line.id}/versions`, { headers: auth(lab) })).json()).data;
        return (versions.versions || versions.history || []).filter((v) => v.authorised_at).length;
      };
      await expect.poll(releasedCount, { message: 'released once', timeout: 15000 }).toBe(1);
      await expect(page.getByText(/released/i).first(), 'the technologist is shown it was released').toBeVisible({ timeout: 15000 });
      await expect(page.locator('table').getByText(`${patient.first_name} ${patient.last_name}`)).toHaveCount(0, { timeout: 15000 });
    });
  });

  // ── The Admin and the Super Admin ──────────────────────────────────────────────────────────

  test.describe('the Admin and the Super Admin', () => {
    test('an HMO claim approved but the reply lost: the panel shows it approved, not "could not approve"', async ({ page }) => {
      const { person, visit } = await walkIn();
      const provider = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(desk) })).json()).data.providers[0];
      const [line] = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(desk) })).json()).data.visitTests;
      const claim = await ctx.post(`${API}/hmo/request`, {
        headers: auth(desk), data: { hmoProviderId: provider.id, memberNumber: '1CH-0000777', visitTestIds: [line.id], referringPhysician: 'Dr. Reyes' },
      });
      expect(claim.status(), await claim.text()).toBe(201);
      const claimId = ((await claim.json()).data.request || (await claim.json()).data).id;

      await signInTo(page, 'clinicadmin@enlogada.com', 'Service Requests');
      await page.getByRole('row', { name: new RegExp(`${person.lastName}.*Ticket ${visit.queue_number}`) }).getByRole('button', { name: 'Review' }).click({ timeout: 20000 });
      const dialog = page.getByRole('dialog');
      await dialog.getByPlaceholder('e.g. LOA-2026-00481').fill('LOA-QA-0001');
      await cut(page, '**/approve', 'replyLost');
      await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
      await expect(dialog.getByText(/read again/i)).toBeVisible({ timeout: 15000 });
      await expect(dialog.getByRole('button', { name: 'Approve', exact: true }), 'no Approve left on a decided claim').toHaveCount(0);
      const stored = (await (await ctx.get(`${API}/hmo/request/${claimId}`, { headers: auth(superAdmin) })).json()).data.request;
      expect(stored.status).toBe('Approved');
    });

    test('an online payment verified but the reply lost: the dialog closes and the payment leaves the list, receipted once', async ({ page }) => {
      const p = await withBooking(252);
      const reference = `VER${Date.now()}`;
      const amount = Number((await (await ctx.get(`${API}/payments/bill/${p.appt.patient_visit_id}`, { headers: auth(till) })).json()).data.bill.totalAmount);
      const proof = await ctx.post(`${API}/payment-submissions`, {
        headers: auth(p.token),
        multipart: { patientVisitId: String(p.appt.patient_visit_id), paymentMethodId: String(method.id), referenceNumber: reference, proof: { name: 'r.png', mimeType: 'image/png', buffer: PNG } },
      });
      expect(proof.status(), await proof.text()).toBe(201);
      expect(amount).toBeGreaterThan(0);

      await signInTo(page, 'multirole@enlogada.com', 'Online Payments');
      const row = page.locator('li').filter({ hasText: reference }).first();
      await row.getByRole('button', { name: /Verify & issue receipt/i }).click({ timeout: 20000 });
      const confirm = page.getByRole('dialog');
      await cut(page, '**/verify', 'replyLost');
      await confirm.getByRole('button', { name: /^Record payment$/ }).click();
      await expect(confirm).toBeHidden({ timeout: 15000 });
      const stillWaiting = page.locator('li').filter({ hasText: reference }).getByRole('button', { name: /Verify & issue receipt/i });
      await expect(stillWaiting, 'no longer waiting').toHaveCount(0, { timeout: 15000 });
      await expect(page.locator('li').filter({ hasText: reference }).getByText('Verified')).toBeVisible();
      expect(await receiptsOn(p.appt.patient_visit_id)).toHaveLength(1);
    });

    test('a refund recorded but the reply lost: never "nothing was changed", and never refunded twice', async ({ page }) => {
      const { visit } = await walkIn();
      const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth(till) })).json()).data.bill;
      const payment = (await (await ctx.post(`${API}/payments`, {
        headers: auth(till), data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: Number(bill.totalAmount) },
      })).json()).data.payment;

      await signInTo(page, 'admin@enlogada.com', 'Cashier Monitoring');
      await page.getByRole('row').filter({ hasText: payment.receipt_number }).getByTestId('refund-open').click({ timeout: 20000 });
      const dialog = page.getByTestId('refund-dialog');
      await dialog.getByLabel('The payment was recorded by mistake').check();
      await dialog.locator('#refund-reason').fill('Charged to the wrong patient.');
      await cut(page, '**/refund', 'replyLost');
      await dialog.getByTestId('refund-confirm').click();
      await expect(page.getByText(/may have been recorded/i).first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Nothing was changed/i)).toHaveCount(0);

      const options = (await (await ctx.get(`${API}/payments/${payment.id}/refund`, { headers: auth(superAdmin) })).json()).data;
      expect(Number(options.refunded), 'refunded once, the whole receipt').toBeCloseTo(Number(payment.amount), 2);
      expect(Number(options.remaining), 'nothing left to refund').toBe(0);
      const again = await ctx.post(`${API}/payments/${payment.id}/refund`, {
        headers: auth(superAdmin), data: { kind: 'recorded_by_mistake', reason: 'Again.', returnedVia: 'Cash' },
      });
      expect(again.status(), 'a second refund is refused').toBe(409);
    });
  });
});
