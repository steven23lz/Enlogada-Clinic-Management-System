// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';
import { registerClient, setAuthCode, TEST_CODE } from './helpers/accounts.js';
import { pdfReport } from './helpers/reportFile.js';
import { nthWorkingDay } from './helpers/dates.js';
import { appointmentForm, bookableTestId, removeUnpaid } from './helpers/booking.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';

/**
 * Taking a mistake back. [1.156.0] Found by walking the staff side as [1.151.0] walked the patient's:
 * a report released on the wrong patient stayed readable while it was corrected, and a booking checked
 * in by mistake could not be undone at all. Also what a patient agrees to at sign-up, and a patient who
 * can no longer open their sign-in email.
 */

const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

test.describe('Corrections [1.156.0]', () => {
  let ctx;
  let cashier, reception, superAdmin, admin, lab, xray;
  let labTestId;

  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [cashier, reception, superAdmin, admin, lab, xray] = await Promise.all(
      ['cashier@enlogada.com', 'receptionist@enlogada.com', 'admin@enlogada.com', 'clinicadmin@enlogada.com', 'lab@enlogada.com', 'xray@enlogada.com'].map(login)
    );
    const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
    labTestId = tests.find((t) => t.category_name === 'Laboratory' && t.is_active).id;
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  /** A patient with their own portal account and one profile. */
  async function client() {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token, user } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const created = await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, token, 'Self Pay'),
        ...person, birthdate: '1984-06-14', sex: 'Female', contactNumber: FIXTURE_CONTACT,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    return { token, user, email, patient: (await created.json()).data.patient };
  }

  const payInCash = async (visitId) => {
    const bill = (await (await ctx.get(`${API}/payments/bill/${visitId}`, { headers: auth(cashier) })).json()).data.bill;
    const paid = await ctx.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: Number(bill.totalAmount) },
    });
    expect(paid.status(), await paid.text()).toBe(201);
  };

  const attach = async (visitTestId, name = 'report.pdf') => {
    const saved = await ctx.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab),
      multipart: { file: { name, mimeType: 'application/pdf', buffer: pdfReport(name) } },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
  };
  const release = (visitTestId) => ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) });

  /** A paid walk-in on a portal account, its laboratory report released. */
  async function releasedReport() {
    const owner = await client();
    const created = await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: owner.patient.id, visitType: 'Walk in', testIds: [labTestId] },
    });
    expect(created.status(), await created.text()).toBe(201);
    const visitId = (await created.json()).data.visit.id;
    await payInCash(visitId);
    const rows = (await (await ctx.get(`${API}/results/pending/Laboratory?limit=500`, { headers: auth(lab) })).json()).data.pending;
    const visitTestId = rows.find((r) => r.visit_id === visitId).visit_test_id;
    await attach(visitTestId, 'first.pdf');
    expect((await release(visitTestId)).status()).toBe(200);
    return { owner, visitId, visitTestId };
  }

  const patientReads = async (owner, visitTestId) => {
    const res = await ctx.get(`${API}/results/history/${owner.patient.id}`, { headers: auth(owner.token) });
    return (await res.json()).data.results.filter((r) => r.visit_test_id === visitTestId && r.result_id);
  };
  const withdraw = (visitTestId, reason = 'Released on the wrong patient', token = lab) =>
    ctx.post(`${API}/results/${visitTestId}/withdraw`, { headers: auth(token), data: { reason } });

  test.describe('Withdrawing a released report', () => {
    test('the patient loses it at once, and it returns to the worklist with no report', async () => {
      const { owner, visitId, visitTestId } = await releasedReport();
      expect((await patientReads(owner, visitTestId)).length).toBe(1);

      expect((await withdraw(visitTestId, '   ')).status(), 'it asks why').toBe(400);

      const res = await withdraw(visitTestId);
      expect(res.status(), await res.text()).toBe(200);
      expect(await patientReads(owner, visitTestId)).toEqual([]);
      const file = await ctx.get(`${API}/results/${visitTestId}/file`, { headers: auth(owner.token) });
      expect(file.status()).not.toBe(200);

      const rows = (await (await ctx.get(`${API}/results/pending/Laboratory?limit=500`, { headers: auth(lab) })).json()).data.pending;
      const row = rows.find((r) => r.visit_id === visitId);
      expect(row, 'back on the worklist').toBeTruthy();
      expect(row.test_status).toBe('Processing');

      expect((await withdraw(visitTestId)).status(), 'nothing is left to withdraw').toBe(409);
      expect((await release(visitTestId)).ok(), 'that file can never go back out by a click').toBe(false);
    });

    test('the public check says withdrawn, and nothing about the patient or the test', async () => {
      const { visitTestId } = await releasedReport();
      const current = (await (await ctx.get(`${API}/results/${visitTestId}`, { headers: auth(lab) })).json()).data;
      const code = (current.result ?? current).verification_code;
      expect(code).toBeTruthy();
      expect((await (await ctx.get(`${API}/verify/${code}`)).json()).data.report.status).toBe('genuine');

      await withdraw(visitTestId);
      const after = (await (await ctx.get(`${API}/verify/${code}`)).json()).data.report;
      expect(after.status).toBe('withdrawn');
      expect(after.patientInitials).toBeUndefined();
      expect(after.testName).toBeUndefined();
    });

    test('the right report goes out as a new version, and the withdrawn one stays in the history', async () => {
      const { owner, visitTestId } = await releasedReport();
      await withdraw(visitTestId);

      await attach(visitTestId, 'right.pdf');
      expect((await release(visitTestId)).status()).toBe(200);

      const { versions } = (await (await ctx.get(`${API}/results/${visitTestId}/versions`, { headers: auth(lab) })).json()).data;
      expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
      const first = versions.find((v) => v.version === 1);
      expect(first.withdrawn_reason).toBe('Released on the wrong patient');
      expect(first.file_original_name).toBe('first.pdf');

      const reads = await patientReads(owner, visitTestId);
      expect(reads.length).toBe(1);
      expect(reads[0].file_original_name).toBe('right.pdf');
    });

    test('another department cannot, a front desk cannot, and it is in the Activity Log', async () => {
      const { visitTestId } = await releasedReport();
      expect((await withdraw(visitTestId, 'Not mine', xray)).status()).toBe(403);
      expect((await withdraw(visitTestId, 'Not mine', reception)).status()).toBe(403);

      const reason = `Wrong file attached ${Date.now()}`;
      expect((await withdraw(visitTestId, reason)).status()).toBe(200);
      const log = await (await ctx.get(`${API}/admin/activity?limit=20`, { headers: auth(superAdmin) })).text();
      expect(log).toContain('result.withdrawn');
      expect(log).toContain(reason);
    });

    test('History offers Withdraw, which waits for a reason', async ({ page }) => {
      await releasedReport();
      await signInTo(page, 'lab@enlogada.com', 'Laboratory History');
      await page.getByTestId('withdraw-report').first().click();
      const dialog = page.getByRole('dialog');
      const confirm = dialog.getByRole('button', { name: 'Withdraw report' });
      await expect(confirm).toBeDisabled();
      await dialog.getByRole('textbox').fill('Released on the wrong patient');
      await expect(confirm).toBeEnabled();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toHaveCount(0);
    });
  });

  test.describe('Undoing a check-in', () => {
    const claimed = new Set();

    /** A patient's own booking on a working day some way off. */
    async function booking(offset) {
      const owner = await client();
      const date = nthWorkingDay(offset);
      const slots = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(owner.token) })).json()).data.slots;
      const slot = slots.find((s) => s.available && !claimed.has(`${date} ${s.time}`));
      claimed.add(`${date} ${slot.time}`);
      const made = await ctx.post(`${API}/appointments`, {
        headers: auth(owner.token),
        multipart: appointmentForm({ patientId: owner.patient.id, scheduledDate: date, scheduledTime: slot.time, testIds: [await bookableTestId(ctx)] }),
      });
      expect(made.status(), await made.text()).toBe(201);
      return { owner, date, time: slot.time, appointment: (await made.json()).data.appointment };
    }

    const checkIn = (id) => ctx.patch(`${API}/appointments/${id}/status`, { headers: auth(reception), data: { status: 'Confirmed' } });
    const undo = (id, reason = 'Checked in the wrong patient', token = reception) =>
      ctx.post(`${API}/appointments/${id}/undo-check-in`, { headers: auth(token), data: { reason } });
    const queueRow = async (ticket) => {
      const body = (await (await ctx.get(`${API}/visits/active?limit=100&search=${ticket}`, { headers: auth(reception) })).json()).data;
      return (body.visits ?? body).find((v) => v.queue_number === ticket);
    };

    test('it leaves the queue, gives up its ticket, and goes back to its own date', async () => {
      const { appointment, date, time } = await booking(40);
      const res = await checkIn(appointment.id);
      expect(res.status(), await res.text()).toBe(200);
      const ticket = (await res.json()).data.appointment?.queue_number ?? (await res.json()).data.queue_number;
      expect(ticket).toBeTruthy();

      const row = await queueRow(ticket);
      expect(row.appointment_id).toBe(appointment.id);
      expect(row.appointment_status).toBe('Confirmed');
      expect(row.work_started).toBe(false);

      expect((await undo(appointment.id, ' ')).status(), 'it asks why').toBe(400);

      const undone = await undo(appointment.id);
      expect(undone.status(), await undone.text()).toBe(200);
      const body = (await undone.json()).data;
      expect(body.movedBack).toBe(true);
      expect(body.appointment.status).toBe('Pending');
      expect(new Date(body.appointment.scheduled_date).toLocaleDateString('en-CA')).toBe(date);
      expect(String(body.appointment.scheduled_time).slice(0, 5)).toBe(String(time).slice(0, 5));

      expect(await queueRow(ticket), 'gone from today').toBeUndefined();
      expect((await undo(appointment.id)).status(), 'nothing left to undo').toBe(409);
      removeUnpaid(appointment.id);
    });

    test('checked in again, it gets a new ticket', async () => {
      const { appointment } = await booking(41);
      const firstBody = (await (await checkIn(appointment.id)).json()).data;
      const first = firstBody.appointment?.queue_number ?? firstBody.queue_number;
      await undo(appointment.id, 'Too early');
      const again = await checkIn(appointment.id);
      expect(again.status(), await again.text()).toBe(200);
      const secondBody = (await again.json()).data;
      const second = secondBody.appointment?.queue_number ?? secondBody.queue_number;
      expect(second).toBeTruthy();
      expect(second).not.toBe(first);
      removeUnpaid(appointment.id);
    });

    test('once a department has started on it, it can no longer be undone', async () => {
      const { appointment } = await booking(42);
      await checkIn(appointment.id);
      const visitId = appointment.patient_visit_id;
      await payInCash(visitId);
      const rows = (await (await ctx.get(`${API}/results/pending/Laboratory?limit=500`, { headers: auth(lab) })).json()).data.pending;
      const row = rows.find((r) => r.visit_id === visitId);
      test.skip(!row, 'the bookable test is not a laboratory one on this database');
      await attach(row.visit_test_id, 'draft.pdf');

      const refused = await undo(appointment.id);
      expect(refused.status()).toBe(409);
      expect((await refused.json()).message).toMatch(/already been started/i);
    });

    test('a laboratory account is refused', async () => {
      const { appointment } = await booking(44);
      await checkIn(appointment.id);
      expect((await undo(appointment.id, 'Not mine', lab)).status()).toBe(403);
      await undo(appointment.id);
      removeUnpaid(appointment.id);
    });

    test('the Desk offers it on the row, and it waits for a reason', async ({ page }) => {
      const { appointment, owner } = await booking(43);
      await checkIn(appointment.id);

      await signInTo(page, 'receptionist@enlogada.com', 'Desk');
      await page.getByRole('searchbox', { name: "Who's here?" }).fill(owner.patient.last_name);
      const row = page.locator('tr').filter({ hasText: owner.patient.last_name }).filter({ has: page.getByTestId('undo-check-in') }).first();
      await row.getByTestId('undo-check-in').click();
      const dialog = page.getByRole('dialog');
      const confirm = dialog.getByRole('button', { name: 'Undo check-in' });
      await expect(confirm).toBeDisabled();
      await dialog.getByRole('textbox').fill('Checked in the wrong patient');
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('tr').filter({ hasText: owner.patient.last_name }).filter({ has: page.getByTestId('undo-check-in') })).toHaveCount(0);
      removeUnpaid(appointment.id);
    });
  });

  test.describe('A member of staff who has left', () => {
    test('deactivating them ends their session at once, and they cannot sign in', async () => {
      const person = fixturePerson();
      const email = fixtureEmail(person);
      const made = await ctx.post(`${API}/admin/staff`, {
        headers: auth(admin),
        data: { firstName: person.firstName, lastName: person.lastName, email, password: PASSWORD, contactNumber: FIXTURE_CONTACT, roles: ['Cashier'] },
      });
      expect(made.status(), await made.text()).toBe(201);
      const body = (await made.json()).data;
      const id = (body.staff || body.user).id;
      const token = await login(email);
      expect((await ctx.get(`${API}/auth/me`, { headers: auth(token) })).status()).toBe(200);

      const off = await ctx.patch(`${API}/admin/staff/${id}/status`, { headers: auth(admin), data: { status: false } });
      expect(off.status(), await off.text()).toBe(200);

      expect((await ctx.get(`${API}/auth/me`, { headers: auth(token) })).status(), 'the session in hand').toBe(401);
      expect((await ctx.get(`${API}/payments/transactions`, { headers: auth(token) })).status(), 'and what it could reach').toBe(401);
      expect((await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).ok(), 'signing in again').toBe(false);
    });
  });

  test.describe('What a patient agrees to', () => {
    test('the server refuses a sign-up without the agreement', async () => {
      const person = fixturePerson();
      const data = { ...person, email: fixtureEmail(person), password: PASSWORD, contactNumber: '' };
      const missing = await ctx.post(`${API}/auth/register`, { data });
      expect(missing.status()).toBe(400);
      expect((await missing.json()).message).toMatch(/Terms of Service/);
      expect((await ctx.post(`${API}/auth/register`, { data: { ...data, acceptedTerms: 'yes' } })).status()).toBe(400);
    });

    test('the form waits for the tick, and its link opens the page in its own tab', async ({ page, context }) => {
      await page.goto('/');
      await page.getByText('Sign In', { exact: true }).first().click();
      await page.getByText('Create Account', { exact: true }).first().click();
      const tick = page.getByTestId('accept-terms');
      await expect(tick).not.toBeChecked();
      expect(await tick.evaluate((el) => el.required)).toBe(true);

      const [terms] = await Promise.all([
        context.waitForEvent('page'),
        page.locator('label').filter({ has: tick }).getByRole('link', { name: 'Terms of Service' }).click(),
      ]);
      await terms.waitForLoadState();
      await expect(terms.getByRole('heading', { name: /terms of service/i }).first()).toBeVisible();
      await terms.close();
      await expect(tick).toBeVisible();
    });
  });

  test.describe('A patient who lost their sign-in email', () => {
    const newAddress = () => `moved${Date.now()}${Math.floor(Math.random() * 1000)}@enlogada-e2e.test`;

    test('at the clinic: a code to the new address moves it, and the old sessions end', async () => {
      const owner = await client();
      const newEmail = newAddress();

      const desk = await ctx.post(`${API}/patients/${owner.patient.id}/account-email`, { headers: auth(reception), data: { newEmail } });
      expect(desk.status(), 'this decides who an account belongs to').toBe(403);

      const started = await ctx.post(`${API}/patients/${owner.patient.id}/account-email`, { headers: auth(admin), data: { newEmail } });
      expect(started.status(), await started.text()).toBe(201);
      const { ticket } = (await started.json()).data;

      const wrong = await ctx.post(`${API}/patients/${owner.patient.id}/account-email/confirm`, { headers: auth(admin), data: { ticket, code: '000000' } });
      expect(wrong.status()).toBe(400);

      setAuthCode(newEmail, 'email_change');
      // Tokens are compared to the second; give the change a moment past the sign-up's own.
      await new Promise((resolve) => { setTimeout(resolve, 2500); });
      const done = await ctx.post(`${API}/patients/${owner.patient.id}/account-email/confirm`, { headers: auth(admin), data: { ticket, code: TEST_CODE } });
      expect(done.status(), await done.text()).toBe(200);

      expect((await ctx.get(`${API}/auth/me`, { headers: auth(owner.token) })).status(), 'the old session ended').toBe(401);
      expect((await ctx.post(`${API}/auth/login`, { data: { email: owner.email, password: PASSWORD } })).status()).toBe(401);
      expect((await ctx.post(`${API}/auth/login`, { data: { email: newEmail, password: PASSWORD } })).status()).toBe(200);

      const log = await (await ctx.get(`${API}/admin/activity?limit=20`, { headers: auth(superAdmin) })).text();
      expect(log).toContain('auth.email_changed_at_clinic');
    });

    test('Portal access offers it on a linked record, in person only', async ({ page }) => {
      const owner = await client();
      await signInTo(page, 'clinicadmin@enlogada.com', 'Patient Records');
      await page.getByLabel('Search patient records').fill(`${owner.patient.first_name} ${owner.patient.last_name}`);
      await page.keyboard.press('Enter');
      const row = page.locator(`[data-testid="patient-row"][data-patient-id="${owner.patient.id}"]`);
      await row.getByTestId('patient-row-invite').click({ timeout: 20000 });
      await page.getByTestId('lost-inbox-open').click();
      await expect(page.getByTestId('lost-inbox')).toContainText('In person only');
      await expect(page.getByRole('button', { name: 'Send a code to it' })).toBeDisabled();
      await page.locator('#lost-inbox-email').fill(newAddress());
      await expect(page.getByRole('button', { name: 'Send a code to it' })).toBeEnabled();
    });

    test('a record with no account has nothing to move', async () => {
      const person = fixturePerson();
      const created = await ctx.post(`${API}/patients`, {
        headers: auth(reception),
        data: {
          patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
          ...person, birthdate: '1991-01-11', sex: 'Male', contactNumber: FIXTURE_CONTACT,
        },
      });
      const walkIn = (await created.json()).data.patient;
      const res = await ctx.post(`${API}/patients/${walkIn.id}/account-email`, { headers: auth(admin), data: { newEmail: newAddress() } });
      expect(res.status()).toBe(409);
    });
  });
});
