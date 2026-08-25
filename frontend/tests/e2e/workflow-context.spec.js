// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { selfPayProfile } from './helpers/patients.js';

// Information each role needs *on the screen where they act*, rather than one screen away.
//
// These came out of a business-process walkthrough — following a visit from the front desk to the
// modality to the patient — rather than from a bug report. Each one was a case where the data
// already existed, the API already returned it, and the screen that needed it did not show it.
// That is the failure mode a page-by-page smoke test cannot see: every screen loads, nothing
// errors, and the work is still harder than it should be.

const PASSWORD = 'Password123!';
const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;


test('the diagnostic worklist shows age and sex, which decide the reference range', async ({ page }) => {
  // Not cosmetic. Diagnostic reference ranges are banded by age and by sex — a haemoglobin that
  // is normal for a 40-year-old man is anaemia in a child — so a technician recording findings
  // has to know which band applies. The query returned birthdate and sex all along; the worklist
  // rendered neither, and the tech had to open a second screen to find out.
  await signIn(page, 'lab@enlogada.com');
  await expect(page.getByRole('heading', { name: /laboratory operations worklist/i }))
    .toBeVisible({ timeout: 15000 });

  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 15000 });

  // "PT-12 · 31y · Male" under the patient's name.
  const first = rows.first();
  await expect(first).toContainText(/\d+y/);
  await expect(first).toContainText(/Male|Female/);
});

test('the diagnostic worklist names the referring physician when there is one', async ({ page }) => {
  // The report goes back to this doctor, and a technician querying an odd result needs to know
  // who to call. [1.23.0] recorded it and put it on the report and the HMO review; the worklist
  // — where the work happens — was missed.
  await signIn(page, 'lab@enlogada.com');
  await expect(page.getByRole('heading', { name: /laboratory operations worklist/i }))
    .toBeVisible({ timeout: 15000 });

  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
  // The seeded worklist tickets carry a referrer, so at least one row shows it.
  await expect(page.getByText(/Ref: Dr\./).first()).toBeVisible({ timeout: 10000 });
});

test('an upcoming booking tells the patient what to do beforehand', async ({ page }) => {
  // [1.24.0] put preparation in the booking wizard and the confirmation email, then left it off
  // the one screen a patient opens the day before to check the time. A patient who booked three
  // weeks ago and wants to re-read the instruction had nowhere to look.
  //
  // This books its OWN appointment on a test that carries preparation, and then finds that exact
  // card. It used to assert on `[data-testid="appointment-card"]` .first() — whatever booking the
  // database happened to hold — so it passed or failed on ambient data: booking anything through
  // the UI, as a developer demoing the app does, put a card with no preparation at the front and
  // turned this red with nothing in the app having changed. Which made it a test of the seed data
  // rather than of the screen.
  const ctx = await request.newContext();
  const token = (await (await ctx.post(`${API}/auth/login`, {
    data: { email: 'client@enlogada.com', password: PASSWORD },
  })).json()).data.token;
  const auth = { Authorization: `Bearer ${token}` };

  // Read which test carries preparation rather than naming one: the catalogue is the clinic's to
  // edit, and a fixture name hard-coded here is a second source of truth for it.
  const prepped = (await (await ctx.get(`${API}/tests`)).json()).data.tests
    .find((t) => t.is_active && t.preparation);
  expect(prepped, 'the catalogue needs at least one active test with preparation').toBeTruthy();

  const patientId = selfPayProfile(
    (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth })).json()).data.patients
  ).id;

  // Far out, and past the weekend — the clinic is shut on Sunday and closes at noon on Saturday,
  // so a nearer date makes this fail on the day of the week rather than on the app.
  const day = new Date();
  day.setDate(day.getDate() + 120 + (Date.now() % 25));
  while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

  const free = (await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth })).json())
    .data.slots.filter((s) => s.available);
  test.skip(free.length === 0, 'Need a free slot to book into.');

  const created = await ctx.post(`${API}/appointments`, {
    headers: auth,
    data: { patientId, scheduledDate: date, scheduledTime: free[0].time, testIds: [prepped.id] },
  });
  expect(created.status()).toBe(201);
  const reference = (await created.json()).data.appointment.appointment_reference;
  await ctx.dispose();

  await signIn(page, 'client@enlogada.com');

  await page.getByRole('tab', { name: 'Appointments' }).click();
  await expect(page.locator('[data-testid="appointment-card"]').first()).toBeVisible({ timeout: 15000 });

  // Page to the booking just made rather than assuming it is on page one — open bookings sort
  // soonest-first, eight to a page, and this one is deliberately months out.
  const card = page.locator(`[data-testid="appointment-card"][data-reference="${reference}"]`);
  const nextPage = page.getByLabel('Next page');
  for (let i = 0; i < 12 && (await card.count()) === 0; i += 1) {
    if (!(await nextPage.isEnabled().catch(() => false))) break;
    await nextPage.click();
    await page.waitForTimeout(150);
  }
  await expect(card, 'the booking just created should be somewhere in the list').toBeVisible();

  await expect(card.getByText('Before this appointment')).toBeVisible({ timeout: 10000 });
  await expect(card.getByText(prepped.preparation.slice(0, 30), { exact: false })).toBeVisible();
});
