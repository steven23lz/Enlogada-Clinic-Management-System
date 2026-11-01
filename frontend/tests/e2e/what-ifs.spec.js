// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';
import { appointmentForm, bookableTestId } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { patientTypeId } from './helpers/patients.js';
import { API, CREDS, PNG, loginAs, billedVisit, submitProof, ensureMethod } from './helpers/payments.js';
import { runScript } from './helpers/backendScript.js';

/**
 * What-ifs, each a rule that held at one moment and not at the next. [1.146.0]
 *
 * Steven, after the booking-notice bug: list the what-ifs, so they are mitigated before anyone
 * meets them. Each test is one, in the words a patient or the clinic would ask it:
 *
 *   - A senior or a PWD who books online: the discount is declared with the ID, the bill is
 *     discounted, and the money waits for whoever takes it to check the ID.
 *   - The bill changing under a payment the patient has already sent.
 *   - A patient who no longer wants an unpaid booking (their HMO said no, or they changed their mind).
 *   - A proof turned down after the appointment time: the booking goes, the reference stays on record.
 *   - A special Sunday "opened" with no hours.
 */

const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

/** A throwaway patient with an account and one Self Pay profile on the fixture number. */
async function clientWithProfile(ctx, { birthdate = '1990-03-14' } = {}) {
  const person = fixturePerson();
  const email = fixtureEmail(person);
  const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
  const profile = (await (await ctx.post(`${API}/patients`, {
    headers: auth(token),
    data: {
      patientTypeId: await patientTypeId(ctx, API, token, 'Self Pay'),
      firstName: person.firstName, lastName: person.lastName, birthdate, sex: 'Female',
      address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, emergencyContact: '',
    },
  })).json()).data.patient;
  return { person, email, token, profile };
}

/** The first free slot on a far working day, different for each caller so bookings never share one. */
let dayOffset = 0;
async function freeSlot(ctx, token) {
  for (let i = 0; i < 10; i += 1) {
    dayOffset += 1;
    const date = nthWorkingDay(170 + (Date.now() % 40) + dayOffset);
    const slots = (await (await ctx.get(`${API}/appointments/availability`, { headers: auth(token), params: { date } })).json())
      .data.slots.filter((s) => s.available);
    if (slots.length) return { date, time: slots[slots.length - 1 - (dayOffset % Math.min(3, slots.length))].time };
  }
  throw new Error('no free slot in ten working days');
}

/** A patient's own booking; `discount` adds a declared Senior Citizen / PWD discount with an ID photo. */
async function book(ctx, token, profileId, { discount = null, idPhoto = true } = {}) {
  const { date, time } = await freeSlot(ctx, token);
  const form = appointmentForm({ patientId: profileId, scheduledDate: date, scheduledTime: time, testIds: [await bookableTestId(ctx)] });
  if (discount) {
    form.append('discountKind', discount.kind);
    form.append('discountIdNumber', discount.idNumber);
    if (idPhoto) form.append('discountId', new Blob([PNG], { type: 'image/png' }), 'id.png');
  }
  return ctx.post(`${API}/appointments`, { headers: auth(token), multipart: form });
}

const myBooking = async (ctx, token, id) =>
  (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(token) })).json()).data.bookings.find((b) => b.id === id);

test.describe('What-ifs [1.146.0]', () => {
  let ctx;
  test.beforeAll(async () => { ctx = await request.newContext(); });
  test.afterAll(async () => { await ctx?.dispose(); });

  test('a PWD booking online declares the discount; the bill is discounted, and the money waits for the ID check', async () => {
    const { token, profile } = await clientWithProfile(ctx);

    // Without the photo there is nothing for the clinic to check.
    const noPhoto = await book(ctx, token, profile.id, { discount: { kind: 'pwd', idNumber: 'PWD-10-1234-567' }, idPhoto: false });
    expect(noPhoto.status()).toBe(400);
    expect((await noPhoto.json()).message).toMatch(/photo of your ID/i);
    // A senior's discount is for 60 and over; this profile is not.
    const senior = await book(ctx, token, profile.id, { discount: { kind: 'senior', idNumber: 'OSCA-0001' } });
    expect(senior.status()).toBe(400);
    expect((await senior.json()).message).toMatch(/60 and over/i);

    const res = await book(ctx, token, profile.id, { discount: { kind: 'pwd', idNumber: 'PWD-10-1234-567' } });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()).data;
    const sum = body.visitTests.reduce((s, t) => s + Number(t.price_at_time), 0);
    expect(Number(body.amountDue), 'the confirmation states the discounted bill').toBeLessThan(sum);
    const mine = await myBooking(ctx, token, body.appointment.id);
    expect(Number(mine.amount_due), 'the portal asks for the same figure').toBeCloseTo(Number(body.amountDue), 2);
    expect(mine.discount_name).toBe('PWD');

    // The cashier sees the ID photo, and cannot take the money until it is checked.
    const cashier = await loginAs(ctx, CREDS.superadmin);
    const visitId = body.appointment.patient_visit_id;
    const photo = await ctx.get(`${API}/visits/${visitId}/discount-id`, { headers: auth(cashier) });
    expect(photo.status()).toBe(200);
    expect(photo.headers()['content-type']).toMatch(/image\/png/);

    const pay = (extra) => ctx.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: Number(body.amountDue), ...extra },
    });
    const unchecked = await pay({});
    expect(unchecked.status()).toBe(409);
    expect((await unchecked.json()).message).toMatch(/declared online/i);
    const paid = await pay({ discountIdChecked: true });
    expect(paid.status(), await paid.text()).toBe(201);
    const payment = (await paid.json()).data.payment;
    expect(payment.discount_type_name).toBe('PWD');
    expect(Number(payment.amount)).toBeCloseTo(Number(body.amountDue), 2);
  });

  test('the bill does not change while a payment the patient sent is waiting to be checked', async () => {
    const superToken = await loginAs(ctx, CREDS.superadmin);
    const recToken = await loginAs(ctx, CREDS.receptionist);
    const method = await ensureMethod(ctx, superToken);
    const { visit, total } = await billedVisit(ctx, recToken);
    const sent = await submitProof(ctx, recToken, visit.id, { amount: total, reference: `E2E-LOCK-${Date.now()}`, methodId: method.id });
    expect(sent.status()).toBe(201);
    const submission = (await sent.json()).data.submission;

    const pwd = (await (await ctx.get(`${API}/discounts`, { headers: auth(superToken) })).json()).data.discounts.find((d) => d.name === 'PWD');
    const discount = () => ctx.post(`${API}/discounts/visit/${visit.id}`, {
      headers: auth(superToken), data: { discountTypeId: pwd.id, idNumber: 'PWD-10-0000-001' },
    });
    const refused = await discount();
    expect(refused.status(), 'a discount under a payment already sent').toBe(409);
    expect((await refused.json()).message).toMatch(/waiting to be checked/i);

    const addTest = await ctx.post(`${API}/tests/visit-tests`, {
      headers: auth(recToken), data: { patientVisitId: visit.id, testIds: [await bookableTestId(ctx)] },
    });
    expect(addTest.status(), 'a test added under a payment already sent').toBe(409);

    // Turned down, the bill may change again.
    const rejected = await ctx.post(`${API}/payment-submissions/${submission.id}/reject`, {
      headers: auth(superToken), data: { reviewNote: 'The screenshot is cut off' },
    });
    expect(rejected.status()).toBe(200);
    expect((await discount()).status()).toBe(200);
  });

  test("a patient releases their own unpaid booking; not someone else's, and not while a payment waits", async () => {
    const owner = await clientWithProfile(ctx);
    const res = await book(ctx, owner.token, owner.profile.id);
    expect(res.status(), await res.text()).toBe(201);
    const appt = (await res.json()).data.appointment;

    const release = (token) => ctx.post(`${API}/appointments/${appt.id}/release`, { headers: auth(token) });
    expect((await release(await loginAs(ctx, { email: 'client@enlogada.com', password: PASSWORD }))).status(), "another patient's").toBe(403);
    expect((await release(await loginAs(ctx, CREDS.receptionist))).status(), 'staff').toBe(403);

    // A payment sent and not yet checked: the money may already be in the clinic's account.
    const superToken = await loginAs(ctx, CREDS.superadmin);
    const method = await ensureMethod(ctx, superToken);
    const sent = await submitProof(ctx, owner.token, appt.patient_visit_id, { amount: 1, reference: `E2E-REL-${Date.now()}`, methodId: method.id });
    expect(sent.status()).toBe(201);
    const waiting = await release(owner.token);
    expect(waiting.status()).toBe(409);
    expect((await waiting.json()).message).toMatch(/waiting to be checked/i);
    await ctx.post(`${API}/payment-submissions/${(await sent.json()).data.submission.id}/reject`, {
      headers: auth(superToken), data: { reviewNote: 'Not received' },
    });

    const ok = await release(owner.token);
    expect(ok.status(), await ok.text()).toBe(200);
    expect(await myBooking(ctx, owner.token, appt.id), 'gone from their bookings').toBeUndefined();
    expect((await release(owner.token)).status()).toBe(404);
  });

  test('a proof turned down after the appointment time releases the booking, and keeps the reference on record', async () => {
    const owner = await clientWithProfile(ctx);
    const res = await book(ctx, owner.token, owner.profile.id);
    expect(res.status(), await res.text()).toBe(201);
    const appt = (await res.json()).data.appointment;
    const superToken = await loginAs(ctx, CREDS.superadmin);
    const method = await ensureMethod(ctx, superToken);
    const reference = `E2E-LATE-${Date.now()}`;
    const sent = await submitProof(ctx, owner.token, appt.patient_visit_id, { amount: 1, reference, methodId: method.id });
    expect(sent.status()).toBe(201);
    const submission = (await sent.json()).data.submission;

    // The cashier did not get to it in time.
    runScript('e2eMoveBookingStart.js', [`--appointment=${appt.id}`, '--minutes-ago=5'], 'move booking start');
    const queue = (await (await ctx.get(`${API}/payment-submissions/pending`, { headers: auth(superToken) })).json()).data.submissions;
    const row = queue.find((s) => s.id === submission.id);
    expect(row.minutes_to_start, 'the queue says its time has passed').toBeLessThan(0);
    const ahead = queue.slice(0, queue.indexOf(row));
    expect(ahead.every((s) => s.minutes_to_start != null && s.minutes_to_start <= row.minutes_to_start),
      'only appointments sooner still are listed ahead of it').toBe(true);

    const rejected = await ctx.post(`${API}/payment-submissions/${submission.id}/reject`, {
      headers: auth(superToken), data: { reviewNote: 'The screenshot is unreadable' },
    });
    expect(rejected.status()).toBe(200);
    expect((await rejected.json()).data.submission.released).toBe(true);
    expect(await myBooking(ctx, owner.token, appt.id), 'the booking was released').toBeUndefined();

    const feed = (await (await ctx.get(`${API}/admin/activity`, { headers: auth(superToken), params: { limit: 50 } })).json()).data.entries;
    const kept = feed.find((e) => e.action === 'payment_submission.kept_on_removal' && String(e.description).includes(reference));
    expect(kept, 'the reference is kept on record for the till').toBeTruthy();
  });

  test('a special Sunday cannot be "opened" without its hours', async () => {
    const superToken = await loginAs(ctx, CREDS.superadmin);
    const sunday = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 200);
      while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    try {
      const bare = await ctx.put(`${API}/schedule/overrides`, { headers: auth(superToken), data: { date: sunday, isOpen: true } });
      expect(bare.status()).toBe(400);
      expect((await bare.json()).message).toMatch(/normally closed/i);
      const withHours = await ctx.put(`${API}/schedule/overrides`, {
        headers: auth(superToken), data: { date: sunday, isOpen: true, openTime: '08:00', closeTime: '12:00' },
      });
      expect(withHours.status()).toBe(200);
    } finally {
      await ctx.delete(`${API}/schedule/overrides/${sunday}`, { headers: auth(superToken) });
    }
  });

  test('the portal offers Release booking on an unpaid booking, and asks first', async ({ page }) => {
    const owner = await clientWithProfile(ctx);
    const res = await book(ctx, owner.token, owner.profile.id);
    expect(res.status(), await res.text()).toBe(201);
    const appt = (await res.json()).data.appointment;

    await signIn(page, owner.email, PASSWORD);
    await openPortalTab(page, 'appointments');
    const card = page.locator('[data-testid="appointment-card"]', { hasText: appt.appointment_reference });
    await expect(card).toBeVisible({ timeout: 20000 });
    await card.getByTestId('booking-release').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Release this booking?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Release booking' }).click();
    await expect(card).toHaveCount(0, { timeout: 15000 });
  });
});
