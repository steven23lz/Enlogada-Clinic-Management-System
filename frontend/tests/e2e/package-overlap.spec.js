// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo } from './helpers/auth.js';
import { openBooking, BOOKING_STEP_TWO } from './helpers/portal.js';
import { nthWorkingDay } from './helpers/dates.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { patientTypeId } from './helpers/patients.js';
import { API, CREDS, loginAs, ensureMethod } from './helpers/payments.js';
import { expireHold } from './helpers/slotHold.js';

/**
 * The same test twice. [1.157.0]
 *
 * Steven: "when he choose all the package but even tho there are same test in there? and still get
 * accepted". All five packages hold the same six tests. Ticking all five quoted ₱9,490 and billed
 * ₱3,214.40, because a test can be on a visit once: the first package kept each shared test and the
 * others were cut down to what was left, at whatever share of their price those few tests carried.
 * A + B billed less than B alone. Then the same test in two slots on one day, each paid for, with a
 * receipt that is final.
 */

const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

let dayOffset = 0;

test.describe('The same test twice [1.157.0]', () => {
  let ctx;
  let desk;
  let cashier;
  let superadmin;
  let packages;
  let tests;
  let A;
  let B;
  let cbc;
  let other;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    desk = await loginAs(ctx, CREDS.receptionist);
    cashier = await loginAs(ctx, CREDS.cashier);
    superadmin = await loginAs(ctx, CREDS.superadmin);
    await ensureMethod(ctx, superadmin);
    packages = (await (await ctx.get(`${API}/packages`)).json()).data.packages
      .filter((p) => !p.name.startsWith('E2E '));
    tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests.filter((t) => t.is_active);
    [A, B] = packages;
    const shared = A.tests.find((t) => B.tests.some((u) => u.id === t.id));
    cbc = tests.find((t) => t.id === shared.id);
    // Not in any package, so booking it says nothing about the package rules.
    const inPackages = new Set(packages.flatMap((p) => p.tests.map((t) => t.id)));
    other = tests.find((t) => !inPackages.has(t.id) && Number(t.price) > 0);
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  async function clientWithProfile() {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const profile = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, token, 'Self Pay'),
        firstName: person.firstName, lastName: person.lastName, birthdate: '1990-03-14', sex: 'Female',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, emergencyContact: '',
      },
    })).json()).data.patient;
    return { person, email, token, profile };
  }

  /** A working day with at least three free slots, and those slots. */
  async function freeDay(token) {
    for (let i = 0; i < 12; i += 1) {
      dayOffset += 1;
      const date = nthWorkingDay(90 + (Date.now() % 60) + dayOffset);
      const slots = (await (await ctx.get(`${API}/appointments/availability`, { headers: auth(token), params: { date } })).json())
        .data.slots.filter((s) => s.available);
      if (slots.length >= 3) return { date, times: slots.map((s) => s.time) };
    }
    throw new Error('no free day in twelve working days');
  }

  const book = (owner, date, time, body) => ctx.post(`${API}/appointments`, {
    headers: auth(owner.token),
    data: { patientId: owner.profile.id, scheduledDate: date, scheduledTime: time, ...body },
  });

  async function deskPatient() {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: {
        patientTypeId: await patientTypeId(ctx, API, desk, 'Self Pay'),
        firstName: person.firstName, lastName: person.lastName, birthdate: '1985-06-20', sex: 'Female',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT,
      },
    })).json()).data.patient;
    return { ...patient, person };
  }

  const walkIn = (patient, body) => ctx.post(`${API}/visits`, {
    headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', ...body },
  });
  const addTo = (visitId, body) => ctx.post(`${API}/tests/visit-tests`, {
    headers: auth(desk), data: { patientVisitId: visitId, ...body },
  });
  const billOf = async (visitId) => (await (await ctx.get(`${API}/payments/bill/${visitId}`, { headers: auth(cashier) })).json()).data.bill;
  const pay = async (visitId) => {
    const bill = await billOf(visitId);
    const res = await ctx.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: Number(bill.totalAmount) },
    });
    expect(res.status(), 'paying the fixture').toBe(201);
  };

  test('every package at once is refused, and nothing is booked', async () => {
    const owner = await clientWithProfile();
    const { date, times } = await freeDay(owner.token);
    const res = await book(owner, date, times[0], { packageIds: packages.map((p) => p.id) });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/both include .*cannot be sold under two/i);

    const mine = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(owner.token) })).json()).data;
    expect(JSON.stringify(mine), 'no booking is left behind').not.toContain(date);
  });

  test('at the desk, two packages together are refused and no ticket is spent', async () => {
    const patient = await deskPatient();
    const res = await walkIn(patient, { packageIds: [A.id, B.id] });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toContain(A.name);

    // The patient has no visit: the next one is simply allowed, and bills its one price.
    const ok = await walkIn(patient, { packageIds: [B.id] });
    expect(ok.status()).toBe(201);
    const bill = await billOf((await ok.json()).data.visit.id);
    expect(Number(bill.totalAmount).toFixed(2), 'the package costs its own price').toBe(Number(B.price).toFixed(2));
  });

  test('a package sharing a test with the one on the visit is refused; the same one again changes nothing', async () => {
    const patient = await deskPatient();
    const visit = (await (await walkIn(patient, { packageIds: [A.id] })).json()).data.visit;

    const added = await addTo(visit.id, { packageIds: [B.id] });
    expect(added.status()).toBe(409);
    expect((await added.json()).message).toMatch(new RegExp(`already has ${A.name}`));
    expect(Number((await billOf(visit.id)).totalAmount).toFixed(2)).toBe(Number(A.price).toFixed(2));

    expect((await addTo(visit.id, { packageIds: [A.id] })).status()).toBe(201);
    expect(Number((await billOf(visit.id)).totalAmount).toFixed(2), 'not charged twice').toBe(Number(A.price).toFixed(2));

    // The remedy the refusal names: take the first off (a loose test keeps the visit from emptying),
    // then the second goes on whole, at its whole price.
    expect((await addTo(visit.id, { testIds: [other.id] })).status()).toBe(201);
    const lines = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(desk) })).json()).data.visitTests;
    const inA = lines.find((l) => Number(l.package_id) === Number(A.id));
    expect((await ctx.delete(`${API}/tests/visit-tests/${inA.id}`, { headers: auth(desk) })).status()).toBe(200);
    expect((await addTo(visit.id, { packageIds: [B.id] })).status()).toBe(201);
    const after = await billOf(visit.id);
    expect(Number(after.totalAmount).toFixed(2)).toBe((Number(B.price) + Number(other.price)).toFixed(2));
  });

  test('a re-sent booking cannot add a package that shares a test, and re-sending the same one is safe, paid or not', async () => {
    const owner = await clientWithProfile();
    const { date, times } = await freeDay(owner.token);
    const first = await book(owner, date, times[0], { packageIds: [A.id] });
    expect(first.status()).toBe(201);
    const visitId = (await first.json()).data.appointment.patient_visit_id;

    const clash = await book(owner, date, times[0], { packageIds: [B.id] });
    expect(clash.status()).toBe(409);
    expect(Number((await billOf(visitId)).totalAmount).toFixed(2)).toBe(Number(A.price).toFixed(2));

    const same = await book(owner, date, times[0], { packageIds: [A.id] });
    expect(same.status(), 'a lost reply re-sent').toBe(200);
    await pay(visitId);
    const afterPaying = await book(owner, date, times[0], { packageIds: [A.id] });
    expect(afterPaying.status(), 'it adds nothing, so a paid booking is no reason to refuse').toBe(200);
  });

  test('packages with nothing in common go together, each at its own price', async () => {
    const free = tests.filter((t) => Number(t.price) > 0).slice(0, 4);
    const make = async (suffix, pair) => (await (await ctx.post(`${API}/packages`, {
      headers: auth(superadmin),
      data: {
        code: `OV${suffix}${Date.now()}`.slice(0, 12), name: `E2E Overlap ${suffix}`,
        price: Number(pair[0].price), testIds: pair.map((t) => t.id),
      },
    })).json()).data.package;
    const one = await make('A', free.slice(0, 2));
    const two = await make('B', free.slice(2, 4));
    try {
      const patient = await deskPatient();
      const res = await walkIn(patient, { packageIds: [one.id, two.id] });
      expect(res.status()).toBe(201);
      const bill = await billOf((await res.json()).data.visit.id);
      expect(Number(bill.totalAmount).toFixed(2)).toBe((Number(one.price) + Number(two.price)).toFixed(2));
    } finally {
      for (const p of [one, two]) {
        await ctx.patch(`${API}/packages/${p.id}`, { headers: auth(superadmin), data: { isActive: false } });
      }
    }
  });

  test('a package and a test inside it is still one price', async () => {
    const patient = await deskPatient();
    const res = await walkIn(patient, { packageIds: [A.id], testIds: [cbc.id] });
    expect(res.status()).toBe(201);
    const bill = await billOf((await res.json()).data.visit.id);
    expect(Number(bill.totalAmount).toFixed(2)).toBe(Number(A.price).toFixed(2));
  });

  test('a patient cannot book one test twice on one day, however it is packaged', async () => {
    const owner = await clientWithProfile();
    const { date, times } = await freeDay(owner.token);
    expect((await book(owner, date, times[0], { testIds: [cbc.id] })).status()).toBe(201);

    const again = await book(owner, date, times[1], { testIds: [cbc.id] });
    expect(again.status()).toBe(409);
    const body = await again.json();
    expect(body.message).toContain(cbc.name);
    expect(body.message).toMatch(/cannot be booked twice on one day/i);
    expect(body.details.repeatTests[0].testId).toBe(cbc.id);

    // The test inside a package is the same test.
    expect((await book(owner, date, times[1], { packageIds: [A.id] })).status()).toBe(409);
    // A patient has no "yes, it is a repeat".
    expect((await book(owner, date, times[1], { testIds: [cbc.id], confirmRepeatTests: true })).status()).toBe(409);

    // What the rule is not: another test that day (fasting bloods, then an ultrasound later) ...
    expect((await book(owner, date, times[1], { testIds: [other.id] })).status()).toBe(201);
    // ... or the same test on another day.
    const later = await freeDay(owner.token);
    expect((await book(owner, later.date, later.times[0], { testIds: [cbc.id] })).status()).toBe(201);
  });

  test('moving a booking onto a day that already has the test is refused too', async () => {
    const owner = await clientWithProfile();
    const day = await freeDay(owner.token);
    const later = await freeDay(owner.token);
    expect((await book(owner, day.date, day.times[0], { testIds: [cbc.id] })).status()).toBe(201);
    const second = await book(owner, later.date, later.times[0], { testIds: [cbc.id] });
    expect(second.status()).toBe(201);
    const { id } = (await second.json()).data.appointment;

    const move = (date, time) => ctx.put(`${API}/appointments/${id}/reschedule`, {
      headers: auth(owner.token), data: { scheduledDate: date, scheduledTime: time, reason: 'Schedule conflict' },
    });
    const onto = await move(day.date, day.times[1]);
    expect(onto.status()).toBe(409);
    expect((await onto.json()).message).toContain(cbc.name);

    // Another time on its own day is not a repeat of itself.
    expect((await move(later.date, later.times[1])).status()).toBe(200);
  });

  test('two requests at once: one package goes on, one test is booked', async () => {
    const patient = await deskPatient();
    const visit = (await (await walkIn(patient, { testIds: [other.id] })).json()).data.visit;
    const both = await Promise.all([addTo(visit.id, { packageIds: [A.id] }), addTo(visit.id, { packageIds: [B.id] })]);
    expect(both.map((r) => r.status()).sort(), 'exactly one of the two').toEqual([201, 409]);
    const bill = await billOf(visit.id);
    const won = both[0].status() === 201 ? A : B;
    expect(Number(bill.totalAmount).toFixed(2)).toBe((Number(won.price) + Number(other.price)).toFixed(2));

    const owner = await clientWithProfile();
    const { date, times } = await freeDay(owner.token);
    const booked = await Promise.all([
      book(owner, date, times[0], { testIds: [cbc.id] }),
      book(owner, date, times[1], { testIds: [cbc.id] }),
    ]);
    expect(booked.map((r) => r.status()).sort(), 'two tabs, two slots').toEqual([201, 409]);
  });

  test('a booking whose time to pay ran out does not stop the patient booking it again', async () => {
    const owner = await clientWithProfile();
    const { date, times } = await freeDay(owner.token);
    const first = await book(owner, date, times[0], { testIds: [cbc.id] });
    expect(first.status()).toBe(201);
    expireHold((await first.json()).data.appointment.id);
    expect((await book(owner, date, times[1], { testIds: [cbc.id] })).status()).toBe(201);
  });

  test('another profile on the same account is another patient', async () => {
    const owner = await clientWithProfile();
    const { date, times } = await freeDay(owner.token);
    expect((await book(owner, date, times[0], { testIds: [cbc.id] })).status()).toBe(201);
    const child = (await (await ctx.post(`${API}/patients`, {
      headers: auth(owner.token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, owner.token, 'Self Pay'),
        firstName: 'Nilo', lastName: owner.person.lastName, birthdate: '2015-03-14', sex: 'Male',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, emergencyContact: '',
      },
    })).json()).data.patient;
    const res = await ctx.post(`${API}/appointments`, {
      headers: auth(owner.token),
      data: { patientId: child.id, scheduledDate: date, scheduledTime: times[1], testIds: [cbc.id] },
    });
    expect(res.status()).toBe(201);
  });

  test('at the desk a repeat on the same day is asked about, and saying yes is on the Activity Log', async () => {
    const patient = await deskPatient();
    const first = (await (await walkIn(patient, { testIds: [cbc.id] })).json()).data.visit;
    await pay(first.id);

    const asked = await walkIn(patient, { testIds: [cbc.id] });
    expect(asked.status()).toBe(409);
    const body = await asked.json();
    expect(body.message).toMatch(/Is this a repeat the doctor asked for/);
    expect(body.details.repeatTests[0]).toMatchObject({ testId: cbc.id, paid: true });

    const another = await walkIn(patient, { testIds: [other.id] });
    expect(another.status(), 'a different test needs no question').toBe(201);
    const second = (await another.json()).data.visit;

    // Adding it to the second visit is the same question: the other door.
    expect((await addTo(second.id, { testIds: [cbc.id] })).status()).toBe(409);
    expect((await addTo(second.id, { testIds: [cbc.id], confirmRepeatTests: true })).status()).toBe(201);

    const log = await (await ctx.get(`${API}/admin/activity`, { headers: auth(superadmin), params: { limit: 10 } })).text();
    expect(log).toContain('same-day repeat');
    expect(log).toContain(cbc.name);
  });

  test('a package never costs more than its tests bought separately', async () => {
    const pair = tests.filter((t) => Number(t.price) > 0).slice(0, 2);
    const parts = pair.reduce((sum, t) => sum + Number(t.price), 0);
    const code = `OVP${Date.now()}`.slice(0, 12);
    const refused = await ctx.post(`${API}/packages`, {
      headers: auth(superadmin),
      data: { code, name: 'E2E Overlap Dear', price: parts + 1, testIds: pair.map((t) => t.id) },
    });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).message).toMatch(/cost less than its tests bought separately/i);

    const made = await ctx.post(`${API}/packages`, {
      headers: auth(superadmin),
      data: { code, name: 'E2E Overlap Fair', price: parts, testIds: pair.map((t) => t.id) },
    });
    expect(made.status()).toBe(201);
    const { id } = (await made.json()).data.package;

    // Repricing alone reads the tests it already has, and a package can always be retired.
    expect((await ctx.patch(`${API}/packages/${id}`, { headers: auth(superadmin), data: { price: parts + 1 } })).status()).toBe(400);

    // Two on offer under one name cannot be told apart on the booking screen.
    const sameName = { name: 'e2e overlap fair ', price: 1, testIds: pair.map((t) => t.id) };
    const twin = await ctx.post(`${API}/packages`, {
      headers: auth(superadmin), data: { ...sameName, code: `OVT${Date.now()}`.slice(0, 12) },
    });
    expect(twin.status()).toBe(409);

    expect((await ctx.patch(`${API}/packages/${id}`, { headers: auth(superadmin), data: { isActive: false } })).status()).toBe(200);
  });

  test('the booking screen stops at the tick, says why, and quotes what will be billed', async ({ page }) => {
    const owner = await clientWithProfile();
    await signIn(page, owner.email, PASSWORD);
    const dialog = await openBooking(page);
    const row = (p) => dialog.locator(`[data-package-code="${p.code}"]`);

    await expect(dialog.getByTestId('package-blocked')).toHaveCount(0);
    await row(A).getByRole('checkbox').check();

    // Every other package here shares a test with A, and each says so.
    for (const p of packages.slice(1)) {
      await expect(row(p).getByRole('checkbox')).toBeDisabled();
      await expect(row(p).getByTestId('package-blocked')).toContainText(`Shares tests with ${A.name}`);
    }
    // What is inside one can still be read before deciding.
    await row(B).getByRole('button', { name: `What is included in ${B.name}` }).click();
    await expect(row(B).getByText(B.tests[0].name)).toBeVisible();

    const total = dialog.getByTestId('picker-total');
    const peso = (n) => Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 });
    await expect(total).toContainText(peso(A.price));

    // Changing one's mind is one untick away.
    await row(A).getByRole('checkbox').uncheck();
    await expect(dialog.getByTestId('package-blocked')).toHaveCount(0);
    await row(B).getByRole('checkbox').check();
    await expect(row(A).getByRole('checkbox')).toBeDisabled();
    await expect(total).toContainText(peso(B.price));

    // The reason wraps on a phone rather than pushing the dialog sideways.
    await page.setViewportSize({ width: 360, height: 740 });
    await expect(row(A).getByTestId('package-blocked')).toBeVisible();
    const overflow = await row(A).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, 'sideways overflow on a phone').toBeLessThanOrEqual(0);
  });

  test('a patient booking a test they already have that day is told, back where the tests are', async ({ page }) => {
    const owner = await clientWithProfile();
    const { date, times } = await freeDay(owner.token);
    expect((await book(owner, date, times[0], { testIds: [cbc.id] })).status()).toBe(201);

    await signIn(page, owner.email, PASSWORD);
    const dialog = await openBooking(page);
    await dialog.locator('#slotpicker-label').fill(date);
    await dialog.locator(`[data-testid="slot-${times[1]}"]`).click();
    await dialog.locator(`[data-package-code="${A.code}"]`).getByRole('checkbox').check();
    await dialog.getByRole('button', { name: BOOKING_STEP_TWO }).click();
    await dialog.getByRole('button', { name: /submit schedule request/i }).click();

    await expect(dialog.getByText(/cannot be booked twice on one day/i)).toBeVisible({ timeout: 20000 });
    // Back on the step with the tests on it, with what they chose still chosen.
    await expect(dialog.locator(`[data-package-code="${A.code}"]`).getByRole('checkbox')).toBeChecked();
  });

  test('Edit Tests shows what the visit already has, and the total is what the bill would gain', async ({ page }) => {
    const patient = await deskPatient();
    const packaged = (await (await walkIn(patient, { packageIds: [A.id] })).json()).data.visit;
    expect(packaged.id).toBeTruthy();

    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    await page.getByRole('searchbox', { name: "Who's here?" }).fill(patient.person.fullName);
    const queueRow = page.locator('tbody tr', { hasText: patient.person.fullName });
    await queueRow.getByRole('button', { name: 'Edit Tests' }).click();

    const dialog = page.getByRole('dialog');
    const rowA = dialog.locator(`[data-package-code="${A.code}"]`);
    const rowB = dialog.locator(`[data-package-code="${B.code}"]`);
    await expect(rowA.getByTestId('package-blocked')).toHaveText('Already on this visit');
    await expect(rowA.getByRole('checkbox')).toBeChecked();
    await expect(rowA.getByRole('checkbox')).toBeDisabled();
    await expect(rowB.getByTestId('package-blocked')).toContainText(`Shares tests with ${A.name}`);

    await dialog.getByPlaceholder('Filter tests…').fill(cbc.name);
    const cbcRow = dialog.locator('label', { hasText: cbc.name }).first();
    await expect(cbcRow).toContainText('on this visit');
    await expect(cbcRow.getByRole('checkbox')).toBeDisabled();
  });

  test('a loose test on the visit: choosing its package quotes the difference, which is what is billed', async ({ page }) => {
    const patient = await deskPatient();
    const visit = (await (await walkIn(patient, { testIds: [cbc.id] })).json()).data.visit;

    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    await page.getByRole('searchbox', { name: "Who's here?" }).fill(patient.person.fullName);
    await page.locator('tbody tr', { hasText: patient.person.fullName }).getByRole('button', { name: 'Edit Tests' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(cbc.name).first()).toBeVisible();
    await dialog.locator(`[data-package-code="${A.code}"]`).getByRole('checkbox').check();
    const gain = Number(A.price) - Number(cbc.price);
    await expect(dialog.getByTestId('picker-total'))
      .toContainText(gain.toLocaleString('en-PH', { minimumFractionDigits: 2 }));

    await dialog.getByRole('button', { name: 'Add to Visit' }).click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
    expect(Number((await billOf(visit.id)).totalAmount).toFixed(2)).toBe(Number(A.price).toFixed(2));
  });

  test('at the Desk, a repeat stops at a question; going back keeps the choice, yes opens the visit', async ({ page }) => {
    const patient = await deskPatient();
    const first = (await (await walkIn(patient, { testIds: [cbc.id] })).json()).data.visit;
    await pay(first.id);

    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    await page.getByRole('searchbox', { name: "Who's here?" }).fill(patient.person.fullName);
    const match = page.getByTestId('desk-match').filter({ hasText: patient.person.fullName });
    await match.getByRole('button', { name: 'Start another visit' }).click({ timeout: 20000 });

    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: 'Confirm Check-In', exact: true });
    await dialog.getByPlaceholder('Filter tests…').fill(cbc.name);
    await dialog.getByRole('checkbox', { name: cbc.name }).first().check();
    await confirm.click();

    const prompt = dialog.getByTestId('repeat-test-prompt');
    await expect(prompt).toContainText(cbc.name);
    await expect(confirm, 'one way forward at a time').toBeDisabled();

    await prompt.getByRole('button', { name: 'Go back' }).click();
    await expect(prompt).toHaveCount(0);
    await expect(dialog.getByRole('checkbox', { name: cbc.name }).first()).toBeChecked();

    await confirm.click();
    await prompt.getByRole('button', { name: 'Yes, it is a repeat' }).click();
    await expect(page.getByText(`${patient.person.fullName} checked in!`)).toBeVisible({ timeout: 15000 });
  });
});
