// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { openPortalTab, openBooking, BOOKING_STEP_TWO } from './helpers/portal.js';
import { appointmentForm, bookableTestId, removeUnpaid } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { patientTypeId } from './helpers/patients.js';
import { API, CREDS, PNG, loginAs, ensureMethod } from './helpers/payments.js';
import { expireHold } from './helpers/slotHold.js';

/**
 * What a patient found, going through the whole system as one. [1.151.0]
 *
 * Steven: "simulate like ur the patient ... run any what ifs ... not finishing the form? transaction
 * what if scenario?" Each test is a step that broke when walked for real, in the words it broke in.
 * The server's half comes first, because a screen that hides a button is not a rule.
 */

const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const png = { name: 'photo.png', mimeType: 'image/png', buffer: PNG };

let dayOffset = 0;

test.describe('What a patient found [1.151.0]', () => {
  let ctx;
  let cashier;
  let desk;
  let admin;
  let method;
  let labTestId;
  let otherTestId;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    cashier = await loginAs(ctx, CREDS.cashier);
    desk = await loginAs(ctx, CREDS.receptionist);
    admin = await loginAs(ctx, CREDS.admin);
    method = await ensureMethod(ctx, await loginAs(ctx, CREDS.superadmin));
    labTestId = await bookableTestId(ctx);
    const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
    otherTestId = tests.find((t) => t.category_name === 'Ultrasound' && t.is_active).id;
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  async function clientWithProfile(over = {}) {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const profile = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, token, 'Self Pay'),
        firstName: person.firstName, lastName: person.lastName, birthdate: '1990-03-14', sex: 'Female',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, emergencyContact: '', ...over,
      },
    })).json()).data.patient;
    return { person, email, token, profile };
  }

  async function freeSlot(token) {
    for (let i = 0; i < 10; i += 1) {
      dayOffset += 1;
      const date = nthWorkingDay(120 + (Date.now() % 40) + dayOffset);
      const slots = (await (await ctx.get(`${API}/appointments/availability`, { headers: auth(token), params: { date } })).json())
        .data.slots.filter((s) => s.available);
      if (slots.length) return { date, time: slots[slots.length - 1 - (dayOffset % Math.min(3, slots.length))].time };
    }
    throw new Error('no free slot in ten working days');
  }

  const post = (token, form) => ctx.post(`${API}/appointments`, { headers: auth(token), multipart: form });

  async function book(owner, { slot, testIds = [labTestId], extra = {}, options = { doctorRequest: false } } = {}) {
    const at = slot || await freeSlot(owner.token);
    const res = await post(owner.token, appointmentForm({
      patientId: owner.profile.id, scheduledDate: at.date, scheduledTime: at.time, testIds, ...extra,
    }, options));
    expect([200, 201], await res.text()).toContain(res.status());
    return { ...(await res.json()).data, slot: at };
  }

  async function hmoBooking(owner) {
    const provider = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(owner.token) })).json()).data.providers[0];
    return book(owner, { extra: { hmo: { providerId: provider.id } }, options: { doctorRequest: true, hmoCard: true } });
  }

  /** A proof, with a file of the caller's choosing. */
  const sendProof = (token, visitId, file = png) => ctx.post(`${API}/payment-submissions`, {
    headers: auth(token),
    multipart: { patientVisitId: String(visitId), paymentMethodId: String(method.id), referenceNumber: `SIM${Date.now()}`, proof: file },
  });
  const billOf = async (visitId) => (await (await ctx.get(`${API}/payments/bill/${visitId}`, { headers: auth(cashier) })).json()).data.bill;
  const mine = async (owner, id) => (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(owner.token) })).json())
    .data.bookings.find((b) => b.id === id);

  test('no proof while the HMO is deciding: it took the hold off for good, and could never be approved', async () => {
    const owner = await clientWithProfile();
    const { appointment } = await hmoBooking(owner);
    const before = (await mine(owner, appointment.id)).held_until;
    expect(before, 'an HMO booking holds until its start').toBeTruthy();

    const sent = await sendProof(owner.token, appointment.patient_visit_id);
    expect(sent.status()).toBe(409);
    expect((await sent.json()).message).toMatch(/HMO is still deciding/i);
    expect((await mine(owner, appointment.id)).held_until, 'the hold is untouched').toBe(before);
  });

  test('no proof when the HMO covers it all: there is nothing to pay', async () => {
    const owner = await clientWithProfile();
    const { appointment, hmoRequest } = await hmoBooking(owner);
    const approved = await ctx.put(`${API}/hmo/request/${hmoRequest.id}/approve`, { headers: auth(admin), data: { approvalCode: 'LOA-1' } });
    expect(approved.status()).toBe(200);
    const sent = await sendProof(owner.token, appointment.patient_visit_id);
    expect(sent.status()).toBe(409);
    expect((await sent.json()).message).toMatch(/covers this booking in full/i);
  });

  test('an empty file or a renamed one is not evidence, wherever it is attached', async () => {
    const owner = await clientWithProfile();
    const empty = { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) };
    const words = { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is not a picture') };

    const { appointment } = await book(owner);
    for (const file of [empty, words]) {
      const res = await sendProof(owner.token, appointment.patient_visit_id, file);
      expect(res.status(), file.name).toBe(400);
      expect((await res.json()).message).toMatch(/empty or damaged/i);
    }
    expect((await mine(owner, appointment.id)).held_until, 'and the deadline still stands').toBeTruthy();

    // The bookings' own files, refused before a booking exists.
    const at = await freeSlot(owner.token);
    const form = appointmentForm({ patientId: owner.profile.id, scheduledDate: at.date, scheduledTime: at.time, testIds: [labTestId] }, { doctorRequest: false });
    form.append('doctorRequest', new Blob(['<html></html>'], { type: 'image/jpeg' }), 'request.jpg');
    const refused = await post(owner.token, form);
    expect(refused.status()).toBe(400);
    expect((await refused.json()).message).toMatch(/doctor's request is empty or damaged/i);

    const avatar = await ctx.post(`${API}/auth/me/avatar`, { headers: auth(owner.token), multipart: { avatar: words } });
    expect(avatar.status()).toBe(400);
  });

  test('a booking re-sent cannot change the bill under a payment already sent, and says when it added a test', async () => {
    const owner = await clientWithProfile();
    const { appointment, slot } = await book(owner);
    const visitId = appointment.patient_visit_id;
    const again = () => post(owner.token, appointmentForm({
      patientId: owner.profile.id, scheduledDate: slot.date, scheduledTime: slot.time, testIds: [otherTestId],
    }, { doctorRequest: false }));
    const billed = Number((await billOf(visitId)).totalAmount);

    const sent = await sendProof(owner.token, visitId);
    expect(sent.status()).toBe(201);
    const under = await again();
    expect(under.status()).toBe(409);
    expect((await under.json()).message).toMatch(/waiting to be checked/i);
    expect(Number((await billOf(visitId)).totalAmount), 'the bill is what they paid').toBe(billed);

    // Turned down, the bill may change again, and the reply says it did.
    const submission = (await sent.json()).data.submission;
    await ctx.post(`${API}/payment-submissions/${submission.id}/reject`, { headers: auth(cashier), data: { reviewNote: 'Blurry' } });
    const added = await again();
    expect(added.status()).toBe(200);
    const body = await added.json();
    expect(body.message).toMatch(/new tests were added/i);
    expect(Number(body.data.amountDue), 'the amount is the bill').toBe(Number((await billOf(visitId)).totalAmount));
  });

  test('a booking re-sent states the bill, discount and all', async () => {
    const owner = await clientWithProfile();
    const slot = await freeSlot(owner.token);
    const form = () => {
      const f = appointmentForm({ patientId: owner.profile.id, scheduledDate: slot.date, scheduledTime: slot.time, testIds: [labTestId] }, { doctorRequest: false });
      f.append('discountKind', 'pwd');
      f.append('discountIdNumber', 'PWD-10-0000-999');
      f.append('discountId', new Blob([PNG], { type: 'image/png' }), 'id.png');
      return f;
    };
    const first = await post(owner.token, form());
    expect(first.status()).toBe(201);
    const due = Number((await first.json()).data.amountDue);
    const second = await post(owner.token, form());
    expect(second.status()).toBe(200);
    expect(Number((await second.json()).data.amountDue), 'not the gross of the tests').toBe(due);
  });

  test('time to pay ran out: the till refuses it, and the patient can simply book that time again', async () => {
    const owner = await clientWithProfile();
    const { appointment, slot } = await book(owner);
    expireHold(appointment.id);
    const bill = await billOf(appointment.patient_visit_id);

    const late = await ctx.post(`${API}/payments`, {
      headers: auth(cashier), data: { patientVisitId: appointment.patient_visit_id, paymentMethod: 'Cash', amount: Number(bill.totalAmount) },
    });
    expect(late.status(), 'someone else may hold that slot now').toBe(409);
    expect((await late.json()).message).toMatch(/not paid in time/i);

    // It told them "you already have this booking", then refused the payment, until the sweep came.
    const again = await post(owner.token, appointmentForm({
      patientId: owner.profile.id, scheduledDate: slot.date, scheduledTime: slot.time, testIds: [labTestId],
    }, { doctorRequest: false }));
    expect(again.status()).toBe(201);
    const fresh = (await again.json()).data.appointment;
    expect(fresh.id).not.toBe(appointment.id);
    const paid = await sendProof(owner.token, fresh.patient_visit_id);
    expect(paid.status(), 'and the new one can be paid').toBe(201);
    removeUnpaid(appointment.id);
  });

  test('checked in during the time to pay, the patient still pays at the till after it runs out', async () => {
    const owner = await clientWithProfile();
    const { appointment } = await book(owner);
    const checkIn = await ctx.put(`${API}/appointments/${appointment.id}/status`, { headers: auth(desk), data: { status: 'Confirmed' } });
    expect(checkIn.status()).toBe(200);
    expireHold(appointment.id);
    const bill = await billOf(appointment.patient_visit_id);
    const pay = await ctx.post(`${API}/payments`, {
      headers: auth(cashier), data: { patientVisitId: appointment.patient_visit_id, paymentMethod: 'Cash', amount: Number(bill.totalAmount) },
    });
    expect(pay.status(), await pay.text()).toBe(201);
  });

  test('GCash or bank at the till needs its reference, as the form says', async () => {
    const owner = await clientWithProfile();
    const { appointment } = await book(owner);
    const visitId = appointment.patient_visit_id;
    const amount = Number((await billOf(visitId)).totalAmount);
    const till = (over) => ctx.post(`${API}/payments`, { headers: auth(cashier), data: { patientVisitId: visitId, amount, ...over } });

    for (const paymentMethod of ['GCash', 'Bank']) {
      const none = await till({ paymentMethod });
      expect(none.status(), paymentMethod).toBe(400);
      expect((await none.json()).message).toContain(`${paymentMethod} reference number`);
      expect((await till({ paymentMethod, referenceNumber: '    ' })).status(), `${paymentMethod}, spaces`).toBe(400);
    }
    expect((await till({ paymentMethod: 'GCash', referenceNumber: `GC${Date.now()}` })).status()).toBe(201);
  });

  test('moving a booking to the time it already has is nothing to move', async () => {
    const owner = await clientWithProfile();
    const { appointment, slot } = await book(owner);
    const res = await ctx.put(`${API}/appointments/${appointment.id}/reschedule`, {
      headers: auth(owner.token), data: { scheduledDate: slot.date, scheduledTime: slot.time, reason: 'Schedule conflict' },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toMatch(/already at that time/i);
    expect((await mine(owner, appointment.id)).reschedule_reason, 'and no reason was recorded').toBeFalsy();
  });

  test('odd requests are refused in words: no body, a password as a list, spaces, a very long address', async () => {
    const bare = await ctx.post(`${API}/auth/register`);
    expect(bare.status()).toBe(400);
    const list = await ctx.post(`${API}/auth/login`, { data: { email: 'client@enlogada.com', password: [PASSWORD] } });
    expect(list.status()).toBe(400);
    const spaces = await ctx.post(`${API}/auth/register`, {
      data: { firstName: 'Lorna', lastName: 'Bacus', email: `spaces${Date.now()}@enlogada-e2e.test`, password: '            ' },
    });
    expect(spaces.status()).toBe(400);
    expect((await spaces.json()).message).toMatch(/only spaces/i);

    const owner = await clientWithProfile();
    const long = await ctx.put(`${API}/patients/${owner.profile.id}`, {
      headers: auth(owner.token),
      data: {
        patientTypeId: owner.profile.patient_type_id, firstName: owner.person.firstName, lastName: owner.person.lastName,
        birthdate: '1990-03-14', sex: 'Female', address: 'A'.repeat(301),
      },
    });
    expect(long.status()).toBe(400);
    expect((await long.json()).message).toMatch(/address is too long/i);
    const words = await ctx.post(`${API}/payment-submissions`, {
      headers: auth(owner.token),
      multipart: { patientVisitId: String((await book(owner)).appointment.patient_visit_id), referenceNumber: `SIM${Date.now()}`, amountClaimed: 'lots', proof: png },
    });
    expect(words.status()).toBe(400);
  });

  // ── On screen ───────────────────────────────────────────────────────────────────────────────

  test('a booking started for one patient does not carry over to another', async ({ page }) => {
    const owner = await clientWithProfile({ firstName: 'Conrada', birthdate: '1950-02-02' });
    await ctx.post(`${API}/patients`, {
      headers: auth(owner.token),
      data: {
        patientTypeId: owner.profile.patient_type_id, firstName: 'Nilo', lastName: owner.person.lastName,
        birthdate: '2001-02-02', sex: 'Male', address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT,
      },
    });
    const slot = await freeSlot(owner.token);
    await signIn(page, owner.email, PASSWORD);

    const chip = page.getByRole('combobox', { name: 'Active patient profile' }).first();
    const choose = async (name) => {
      await chip.click();
      await page.getByRole('option', { name: new RegExp(name) }).click();
    };
    await choose('Conrada');
    let dialog = await openBooking(page);
    await dialog.locator('#slotpicker-label').fill(slot.date);
    await dialog.locator(`[data-testid="slot-${slot.time}"]`).click();
    await dialog.getByRole('checkbox').first().check();
    await dialog.getByRole('button', { name: BOOKING_STEP_TWO }).click();
    await dialog.getByRole('combobox', { name: /senior citizen or pwd/i }).click();
    await page.getByRole('option', { name: /senior citizen/i }).click();
    await dialog.locator('#booking-discount-id-number').fill('OSCA-1234');

    // Closed for the same patient, it is all still there.
    await page.keyboard.press('Escape');
    dialog = await openBooking(page);
    await expect(dialog.locator('#slotpicker-label')).toHaveValue(slot.date);
    await page.keyboard.press('Escape');

    await choose('Nilo');
    dialog = await openBooking(page);
    await expect(dialog.getByText(/for\s+Nilo/)).toBeVisible();
    await expect(dialog.locator('#slotpicker-label'), "the first patient's date").toHaveValue('');
    await expect(dialog.getByRole('checkbox', { checked: true }), "the first patient's tests").toHaveCount(0);
    await dialog.getByRole('button', { name: BOOKING_STEP_TWO }).click();
    await expect(dialog.locator('#booking-discount-id-number'), "the first patient's ID number").toHaveCount(0);
  });

  test('the confirmation does not promise the counter, and the card knows a proof went in from there', async ({ page }) => {
    const owner = await clientWithProfile();
    const slot = await freeSlot(owner.token);
    await signIn(page, owner.email, PASSWORD);
    const dialog = await openBooking(page);
    await dialog.locator('#slotpicker-label').fill(slot.date);
    await dialog.locator(`[data-testid="slot-${slot.time}"]`).click();
    await dialog.getByRole('checkbox').first().check();
    await dialog.getByRole('button', { name: BOOKING_STEP_TWO }).click();
    await dialog.getByRole('button', { name: /submit schedule request/i }).click();
    await expect(dialog.getByText(/APT-[A-Z0-9]+/).first()).toBeVisible({ timeout: 20000 });

    await expect(dialog.getByText(/to keep this slot/i)).toBeVisible();
    await expect(dialog.getByText(/pay at the counter on the day/i), 'it is removed if not paid in time').toHaveCount(0);

    await dialog.getByLabel('These are the tests I want.').check();
    await dialog.locator('input[id^="ref-"]').fill(`GC${Date.now()}`);
    await dialog.locator('input[id^="proof-"]').setInputFiles(png);
    await dialog.getByRole('button', { name: /send for verification/i }).click();
    await expect(dialog.getByText('Payment sent for checking').first()).toBeVisible({ timeout: 15000 });
    await dialog.getByRole('button', { name: 'Done' }).click();

    await openPortalTab(page, 'appointments');
    const card = page.getByTestId('appointment-card').first();
    await expect(card.getByText('Payment sent for checking')).toBeVisible();
    await expect(card.getByText(/to keep this slot/i), 'no deadline on a proof already sent').toHaveCount(0);
    await expect(card.getByTestId('booking-release'), 'and nothing to release').toHaveCount(0);

    // The account on screen is the account recorded, or the cash book guesses.
    const booking = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(owner.token) })).json()).data.bookings[0];
    const submissions = (await (await ctx.get(`${API}/payment-submissions/visit/${booking.patient_visit_id}`, { headers: auth(owner.token) })).json()).data.submissions;
    expect(submissions[0].payment_method_id).toBe(method.id);
  });

  test('why a proof was turned down is said before the patient is asked anything', async ({ page }) => {
    const owner = await clientWithProfile();
    const { appointment } = await book(owner);
    const sent = await sendProof(owner.token, appointment.patient_visit_id);
    await ctx.post(`${API}/payment-submissions/${(await sent.json()).data.submission.id}/reject`, {
      headers: auth(cashier), data: { reviewNote: 'The amount is cut off in the photo' },
    });
    await signIn(page, owner.email, PASSWORD);
    await openPortalTab(page, 'appointments');
    const card = page.getByTestId('appointment-card').first();
    await expect(card.getByTestId('proof-rejected')).toContainText('The amount is cut off in the photo');
    await expect(card.getByLabel('These are the tests I want.')).not.toBeChecked();
  });

  test('a time refused while moving a booking is no longer offered', async ({ page }) => {
    const owner = await clientWithProfile();
    await book(owner);
    const wanted = await freeSlot(owner.token);
    await signIn(page, owner.email, PASSWORD);
    await openPortalTab(page, 'appointments');
    await page.getByTestId('appointment-card').first().getByRole('button', { name: 'Reschedule' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#slotpicker-label').fill(wanted.date);
    await dialog.locator(`[data-testid="slot-${wanted.time}"]`).click();
    await dialog.getByLabel('Schedule conflict').check();

    const rival = await clientWithProfile();
    await book(rival, { slot: wanted });

    await dialog.getByRole('button', { name: 'Confirm new time' }).click();
    await expect(dialog.getByRole('alert')).toContainText(/no longer available/i);
    await expect(dialog.locator(`[data-testid="slot-${wanted.time}"]`), 'the grid was read again').toBeDisabled();
    await expect(dialog.locator('[aria-pressed="true"]'), 'and the time is not left chosen').toHaveCount(0);
  });

  test('a slot taken while filling in the booking goes back to the step with the times on it', async ({ page }) => {
    const owner = await clientWithProfile();
    const slot = await freeSlot(owner.token);
    await signIn(page, owner.email, PASSWORD);
    const dialog = await openBooking(page);
    await dialog.locator('#slotpicker-label').fill(slot.date);
    await dialog.locator(`[data-testid="slot-${slot.time}"]`).click();
    await dialog.getByRole('checkbox').first().check();
    await dialog.getByRole('button', { name: BOOKING_STEP_TWO }).click();

    const rival = await clientWithProfile();
    await book(rival, { slot });

    await dialog.getByRole('button', { name: /submit schedule request/i }).click();
    await expect(dialog.getByRole('alert')).toContainText(/no longer available/i);
    await expect(dialog.locator('#slotpicker-label'), 'on the step that can answer it').toBeVisible();
  });

  test('a file that is neither a photo nor a PDF is called that', async ({ page }) => {
    const owner = await clientWithProfile();
    await signIn(page, owner.email, PASSWORD);
    const dialog = await openBooking(page);
    await dialog.getByRole('button', { name: BOOKING_STEP_TWO }).click();
    await dialog.getByLabel(/doctor's request/i).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(dialog.getByRole('alert')).toContainText(/not a photo or a PDF/i);
  });

  test('a session that ends says so, rather than the form simply becoming the sign-in page', async ({ page }) => {
    const owner = await clientWithProfile();
    await signIn(page, owner.email, PASSWORD);
    await page.getByRole('tab', { name: 'Home', exact: true }).first().waitFor();

    // A password change ends sessions more than a second older than it (auth.js allows that second,
    // because a token's time is in whole seconds), so this session has to be older than that first.
    await new Promise((resolve) => { setTimeout(resolve, 2500); });
    const changed = await ctx.put(`${API}/auth/change-password`, {
      headers: auth(owner.token), data: { currentPassword: PASSWORD, newPassword: 'ChangedPass123!' },
    });
    expect(changed.status()).toBe(200);

    await page.getByRole('button', { name: 'Refresh' }).first().click();
    await expect(page.getByText('You have been signed out. Please sign in again.')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });
});
