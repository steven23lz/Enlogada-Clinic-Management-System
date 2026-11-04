// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';
import { appointmentForm, bookableTestId } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { patientTypeId } from './helpers/patients.js';
import { pdfReport } from './helpers/reportFile.js';
import { API, CREDS, PNG, loginAs, ensureMethod } from './helpers/payments.js';

/**
 * Two of Steven's calls after walking the system as a patient. [1.152.0]
 *
 *   - A patient cannot rewrite the name, birthdate or sex on a record with a released report.
 *   - One GCash or bank transfer pays for one booking: a reference used on another visit is refused,
 *     at the proof, at approval and at the till.
 */

const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const png = { name: 'receipt.png', mimeType: 'image/png', buffer: PNG };
const uniqueReference = (() => { let n = 0; return (prefix = 'GC') => `${prefix}${Date.now()}${(n += 1)}`; })();

let dayOffset = 0;

test.describe('Records and references [1.152.0]', () => {
  let ctx;
  let cashier;
  let desk;
  let lab;
  let method;
  let testId;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    cashier = await loginAs(ctx, CREDS.cashier);
    desk = await loginAs(ctx, CREDS.receptionist);
    lab = await loginAs(ctx, { email: 'lab@enlogada.com', password: PASSWORD });
    method = await ensureMethod(ctx, await loginAs(ctx, CREDS.superadmin));
    testId = await bookableTestId(ctx);
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  async function client() {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const typeId = await patientTypeId(ctx, API, token, 'Self Pay');
    const profile = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: typeId, firstName: person.firstName, lastName: person.lastName, birthdate: '1985-06-06', sex: 'Female',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, emergencyContact: '',
      },
    })).json()).data.patient;
    return { person, email, token, profile, typeId };
  }

  async function book(owner) {
    for (let i = 0; i < 10; i += 1) {
      dayOffset += 1;
      const date = nthWorkingDay(90 + (Date.now() % 25) + dayOffset);
      const free = (await (await ctx.get(`${API}/appointments/availability`, { headers: auth(owner.token), params: { date } })).json())
        .data.slots.filter((s) => s.available);
      if (!free.length) continue;
      const res = await ctx.post(`${API}/appointments`, {
        headers: auth(owner.token),
        multipart: appointmentForm({ patientId: owner.profile.id, scheduledDate: date, scheduledTime: free[0].time, testIds: [testId] }, { doctorRequest: false }),
      });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).data.appointment;
    }
    throw new Error('no free slot in ten working days');
  }

  const sendProof = (token, visitId, reference) => ctx.post(`${API}/payment-submissions`, {
    headers: auth(token),
    multipart: { patientVisitId: String(visitId), paymentMethodId: String(method.id), referenceNumber: reference, proof: png },
  });
  const billOf = async (visitId) => Number((await (await ctx.get(`${API}/payments/bill/${visitId}`, { headers: auth(cashier) })).json()).data.bill.totalAmount);
  const till = async (visitId, over = {}) => ctx.post(`${API}/payments`, {
    headers: auth(cashier),
    data: { patientVisitId: visitId, paymentMethod: 'GCash', amount: await billOf(visitId), ...over },
  });
  const verify = (id) => ctx.post(`${API}/payment-submissions/${id}/verify`, { headers: auth(cashier), data: {} });
  const reject = (id) => ctx.post(`${API}/payment-submissions/${id}/reject`, { headers: auth(cashier), data: { reviewNote: 'Blurry' } });

  /** Paid, checked in, reported and released. */
  async function releasedReport(owner) {
    const appointment = await book(owner);
    const sent = await sendProof(owner.token, appointment.patient_visit_id, uniqueReference());
    expect(sent.status()).toBe(201);
    expect((await verify((await sent.json()).data.submission.id)).status()).toBe(200);
    await ctx.put(`${API}/appointments/${appointment.id}/status`, { headers: auth(desk), data: { status: 'Confirmed' } });
    const rows = (await (await ctx.get(`${API}/results/pending/Laboratory?limit=500`, { headers: auth(lab) })).json()).data.pending;
    const visitTestId = rows.find((r) => r.visit_id === appointment.patient_visit_id).visit_test_id;
    const saved = await ctx.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab), multipart: { file: { name: 'cbc.pdf', mimeType: 'application/pdf', buffer: pdfReport('CBC') } },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    expect((await ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) })).status()).toBe(200);
  }

  const edit = (token, owner, over) => ctx.put(`${API}/patients/${owner.profile.id}`, {
    headers: auth(token),
    data: {
      patientTypeId: owner.typeId, firstName: owner.person.firstName, lastName: owner.person.lastName, birthdate: '1985-06-06',
      sex: 'Female', address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, ...over,
    },
  });

  test('before any report a patient corrects their own details; after one, only the clinic can', async () => {
    const owner = await client();
    expect((await edit(owner.token, owner, { address: 'Purok 1, Bugo' })).status(), 'contact details, before').toBe(200);
    expect((await edit(owner.token, owner, { birthdate: '1985-06-07' })).status(), 'a typing mistake, before').toBe(200);
    expect((await edit(owner.token, owner, { birthdate: '1985-06-06' })).status()).toBe(200);

    await releasedReport(owner);

    for (const change of [{ firstName: 'Somebody' }, { lastName: 'Else' }, { birthdate: '2000-01-01' }, { sex: 'Male' }]) {
      const refused = await edit(owner.token, owner, change);
      expect(refused.status(), JSON.stringify(change)).toBe(403);
      expect((await refused.json()).message).toMatch(/corrected by the clinic/i);
    }
    expect((await edit(owner.token, owner, { address: 'Purok 2, Bugo' })).status(), 'contact details stay theirs').toBe(200);

    const staff = await edit(desk, owner, { lastName: 'Corrected' });
    expect(staff.status(), 'the desk can still correct it').toBe(200);
    expect((await staff.json()).data.patient.last_name).toBe('Corrected');
  });

  test('the form says so, and leaves the contact details open', async ({ page }) => {
    const owner = await client();
    await releasedReport(owner);
    await signIn(page, owner.email, PASSWORD);
    await openPortalTab(page, 'profile');
    await page.getByRole('button', { name: /edit/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('identity-locked')).toBeVisible();
    await expect(dialog.locator('#edit-profile-first-name')).toBeDisabled();
    await expect(dialog.locator('#edit-profile-last-name')).toBeDisabled();
    await expect(dialog.locator('#edit-profile-birthdate')).toBeDisabled();
    await expect(dialog.locator('#edit-profile-sex')).toBeDisabled();

    await dialog.locator('#edit-profile-address').fill('Purok 5, Bugo');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15000 });
    const rows = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(owner.token) })).json()).data;
    expect((rows.profiles || rows.patients || rows)[0].address).toBe('Purok 5, Bugo');
  });

  test('a form on a record with no report is open as before', async ({ page }) => {
    const owner = await client();
    await signIn(page, owner.email, PASSWORD);
    await openPortalTab(page, 'profile');
    await page.getByRole('button', { name: /edit/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('identity-locked')).toHaveCount(0);
    await expect(dialog.locator('#edit-profile-first-name')).toBeEnabled();
  });

  test('a reference on another booking is refused, and says nothing of whose it was', async () => {
    const reference = uniqueReference();
    const a = await client();
    const b = await client();
    const first = await sendProof(a.token, (await book(a)).patient_visit_id, reference);
    expect(first.status()).toBe(201);

    // While the first waits, and after it is verified; another patient, or the same one.
    const other = await book(b);
    const waiting = await sendProof(b.token, other.patient_visit_id, reference);
    expect(waiting.status()).toBe(409);
    const body = await waiting.json();
    expect(body.message).toMatch(/already been used/i);
    expect(body.message).not.toContain(a.person.lastName);

    expect((await verify((await first.json()).data.submission.id)).status()).toBe(200);
    expect((await sendProof(b.token, other.patient_visit_id, reference)).status()).toBe(409);
    expect((await sendProof(b.token, other.patient_visit_id, ` ${reference.toLowerCase()} `)).status(), 'spacing and capitals are the same number').toBe(409);
    const sameFamily = await book(a);
    expect((await sendProof(a.token, sameFamily.patient_visit_id, reference)).status(), 'the same account, another booking').toBe(409);
  });

  test('the same reference again on the same booking is a patient correcting a rejected proof', async () => {
    const owner = await client();
    const visitId = (await book(owner)).patient_visit_id;
    const reference = uniqueReference();
    const first = await sendProof(owner.token, visitId, reference);
    expect(first.status()).toBe(201);
    expect((await reject((await first.json()).data.submission.id)).status()).toBe(200);
    const again = await sendProof(owner.token, visitId, reference);
    expect(again.status(), await again.text()).toBe(201);
    expect((await verify((await again.json()).data.submission.id)).status()).toBe(200);
  });

  test('a rejected proof does not use the reference up for another booking', async () => {
    const owner = await client();
    const reference = uniqueReference();
    const first = await sendProof(owner.token, (await book(owner)).patient_visit_id, reference);
    expect((await reject((await first.json()).data.submission.id)).status()).toBe(200);
    const elsewhere = await sendProof(owner.token, (await book(owner)).patient_visit_id, reference);
    expect(elsewhere.status(), await elsewhere.text()).toBe(201);
  });

  test('the till refuses a reference already on a receipt, or waiting on a proof, and names which', async () => {
    const a = await client();
    const reference = uniqueReference();
    const paid = await till((await book(a)).patient_visit_id, { referenceNumber: reference });
    expect(paid.status(), await paid.text()).toBe(201);
    const receipt = (await paid.json()).data.payment.receipt_number;

    const second = await till((await book(a)).patient_visit_id, { referenceNumber: reference });
    expect(second.status()).toBe(409);
    expect((await second.json()).message).toContain(receipt);

    const waitingRef = uniqueReference();
    expect((await sendProof(a.token, (await book(a)).patient_visit_id, waitingRef)).status()).toBe(201);
    const overProof = await till((await book(a)).patient_visit_id, { referenceNumber: waitingRef });
    expect(overProof.status()).toBe(409);
    expect((await overProof.json()).message).toMatch(/waiting to be checked/i);

    // A bank's reference is another number space, and cash has none.
    const bank = await till((await book(a)).patient_visit_id, { paymentMethod: 'Bank', referenceNumber: reference });
    expect(bank.status(), await bank.text()).toBe(201);
    const cash = await till((await book(a)).patient_visit_id, { paymentMethod: 'Cash' });
    expect(cash.status(), await cash.text()).toBe(201);
  });

  test('two cashiers using one reference at the same moment: one receipt', async () => {
    const a = await client();
    const reference = uniqueReference();
    const visits = [(await book(a)).patient_visit_id, (await book(a)).patient_visit_id];
    const results = await Promise.all(visits.map((v) => till(v, { referenceNumber: reference })));
    expect(results.map((r) => r.status()).sort()).toEqual([201, 409]);
  });
});
