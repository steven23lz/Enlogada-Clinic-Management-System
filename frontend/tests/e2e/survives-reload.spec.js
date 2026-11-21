// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInOnPhone } from './helpers/auth.js';
import { openBooking, openPortalTab, attachDoctorRequest, BOOKING_STEP_TWO } from './helpers/portal.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { appointmentForm, removeUnpaid } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { PNG, ensureMethod } from './helpers/payments.js';

/**
 * A form survives the page reloading under it. [1.173.0]
 *
 * Steven, on his phone: "when i upload the picture in the web app it reload ... i will be back to
 * uploading again". Choosing a photo sends a phone's browser to the background, and Android may
 * discard the page there (the development server also reloaded it on reconnecting). The booking and
 * the payment proof now keep what was entered, photos included, and a sign-out clears it. A camera
 * photo is made smaller before it is sent.
 */

const API = (process.env.E2E_API_URL || 'http://localhost:5000') + '/api';
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });
test.use({ viewport: { width: 390, height: 844 } });

test.describe('Survives a reload [1.173.0]', () => {
  let ctx, superAdmin, usTest;
  test.beforeAll(async () => {
    ctx = await request.newContext();
    superAdmin = (await (await ctx.post(`${API}/auth/login`, { data: { email: 'admin@enlogada.com', password: PASSWORD } })).json()).data.token;
    await ensureMethod(ctx, superAdmin);
    usTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests.find((t) => t.category_name === 'Ultrasound' && t.is_active);
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  const newPatient = async () => {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1990-01-01', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    return { email, token, patient };
  };

  test('a booking half filled in, photo attached, is all still there after the page reloads', async ({ page }) => {
    test.setTimeout(120000);
    const p = await newPatient();
    try {
      await signInOnPhone(page, p.email, PASSWORD);
      const dialog = await openBooking(page);
      const date = nthWorkingDay(249);
      await dialog.locator('#slotpicker-label').fill(date);
      await dialog.locator('[data-testid="slot-09:00"]').click();
      await dialog.getByRole('checkbox').first().check();
      await attachDoctorRequest(dialog);
      await page.waitForTimeout(800); // the draft is written a moment after the last change

      await page.reload();
      const back = page.getByRole('dialog');
      await expect(back, 'the booking reopens by itself').toBeVisible({ timeout: 20000 });
      await expect(back.getByAltText("The doctor's request you attached"), 'with the photo').toBeVisible();
      await back.getByRole('button', { name: /^1\. / }).click();
      await expect(back.locator('#slotpicker-label')).toHaveValue(date);
      await expect(back.locator('[data-testid="slot-09:00"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(back.getByRole('checkbox').first()).toBeChecked();

      // And it books, the restored photo with it.
      await back.getByRole('button', { name: BOOKING_STEP_TWO }).click();
      await back.getByRole('button', { name: /submit schedule request/i }).click();
      await expect(back.getByText(/APT-[A-Z0-9]+/).first()).toBeVisible({ timeout: 20000 });
      const keys = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('enlogada:draft:booking')));
      const left = keys.length ? await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)), keys[0]) : null;
      expect(left?.data?.testIds?.length || 0, 'a finished booking leaves no draft behind').toBe(0);
    } finally {
      const mine = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(p.token) })).json()).data.bookings || [];
      for (const b of mine) await removeUnpaid(b.id || b.appointment_id);
    }
  });

  test('a payment proof chosen, then a reload: reference, tick and screenshot are kept, and it sends', async ({ page }) => {
    test.setTimeout(120000);
    const p = await newPatient();
    const booked = await ctx.post(`${API}/appointments`, {
      headers: auth(p.token),
      multipart: appointmentForm({ patientId: p.patient.id, scheduledDate: nthWorkingDay(250), scheduledTime: '09:00', testIds: [usTest.id] }),
    });
    const appt = (await booked.json()).data.appointment;
    const visitId = appt.patient_visit_id;
    const reference = `KEEP${Date.now()}`;
    try {
      await signInOnPhone(page, p.email, PASSWORD);
      await openPortalTab(page, 'appointments');
      await page.getByTestId('final-tests-check').first().getByRole('checkbox', { name: 'These are the tests I want.' }).check();
      await page.getByLabel('Reference number').first().fill(reference);
      await page.locator(`#proof-${visitId}`).setInputFiles({ name: 'gcash.png', mimeType: 'image/png', buffer: PNG });
      await page.waitForTimeout(800);

      await page.reload();
      await expect(page.getByLabel('Reference number').first(), 'the reference is kept').toHaveValue(reference, { timeout: 20000 });
      await expect(page.getByTestId('final-tests-check').first().getByRole('checkbox', { name: 'These are the tests I want.' })).toBeChecked();
      await page.getByRole('button', { name: 'Send for verification' }).click();
      await expect(page.getByTestId('pay-error')).toHaveCount(0);
      await expect.poll(async () => (await (await ctx.get(`${API}/payment-submissions/visit/${visitId}`, { headers: auth(p.token) })).json()).data.submissions.length,
        { message: 'the screenshot kept across the reload was sent', timeout: 15000 }).toBe(1);
      const keys = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('enlogada:draft:pay:')));
      expect(keys, 'a sent proof leaves no draft behind').toEqual([]);
    } finally {
      try { await removeUnpaid(appt.id); } catch { /* already gone */ }
    }
  });

  test('signing out clears what was kept, so the next person at the computer finds nothing', async ({ page }) => {
    const p = await newPatient();
    await signInOnPhone(page, p.email, PASSWORD);
    const dialog = await openBooking(page);
    await dialog.getByRole('checkbox').first().check();
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('enlogada:draft:')).length)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('enlogada:draft:')).length)).toBe(0);
  });

  test('forgot password, reloaded while the patient reads the code: still on the code step', async ({ page }) => {
    const p = await newPatient();
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByText('Sign In', { exact: true }).last().click();
    await page.getByText('Forgot password?', { exact: true }).click();
    await page.locator('#forgot-email').fill(p.email);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByLabel('New Password')).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.getByLabel('New Password'), 'the code step, not step one').toBeVisible({ timeout: 15000 });
    await expect(page.getByText(p.email).first()).toBeVisible();
  });

  test('changing the sign-in email, reloaded on the code step: the dialog is back on it', async ({ page }) => {
    const p = await newPatient();
    const newEmail = fixtureEmail(fixturePerson());
    await signInOnPhone(page, p.email, PASSWORD);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByTestId('account-menu').getByRole('button', { name: 'My Account' }).click();
    await page.getByRole('button', { name: 'Change email' }).click();
    const dialog = page.getByTestId('change-email');
    await dialog.locator('#change-email-new').fill(newEmail);
    await dialog.locator('#change-email-password').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Send code' }).click();
    await expect(dialog.locator('#change-email-code')).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.getByTestId('change-email').locator('#change-email-code'), 'back on the code step').toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('change-email')).toContainText(newEmail);
    // Closed by the patient, it starts again next time.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Change email' }).click();
    await expect(page.getByTestId('change-email').locator('#change-email-new')).toBeVisible();
  });

  test('a camera-sized photo is made smaller before it is sent as a payment proof', async ({ page }) => {
    test.setTimeout(120000);
    const p = await newPatient();
    const booked = await ctx.post(`${API}/appointments`, {
      headers: auth(p.token),
      multipart: appointmentForm({ patientId: p.patient.id, scheduledDate: nthWorkingDay(251), scheduledTime: '10:00', testIds: [usTest.id] }),
    });
    const appt = (await booked.json()).data.appointment;
    try {
      await signInOnPhone(page, p.email, PASSWORD);
      // A 4000x3000 photo full of detail, as a phone camera makes it: several megabytes.
      const big = Buffer.from(await page.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
        const g = c.getContext('2d'); const img = g.createImageData(4000, 3000);
        for (let i = 0; i < img.data.length; i += 4) { const v = (i * 2654435761) >>> 24; img.data[i] = v; img.data[i + 1] = 255 - v; img.data[i + 2] = (v * 7) & 255; img.data[i + 3] = 255; }
        g.putImageData(img, 0, 0);
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.98));
        return [...new Uint8Array(await blob.arrayBuffer())];
      }));
      expect(big.length, 'the test photo is camera-sized').toBeGreaterThan(2 * 1024 * 1024);
      await openPortalTab(page, 'appointments');
      await page.getByTestId('final-tests-check').first().getByRole('checkbox', { name: 'These are the tests I want.' }).check();
      await page.getByLabel('Reference number').first().fill(`BIG${Date.now()}`);
      const sent = page.waitForRequest((r) => r.url().includes('/api/payment-submissions') && r.method() === 'POST');
      await page.locator(`#proof-${appt.patient_visit_id}`).setInputFiles({ name: 'camera.jpg', mimeType: 'image/jpeg', buffer: big });
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: 'Send for verification' }).click();
      const body = (await sent).postDataBuffer();
      expect(body?.length || 0, 'sent well under the camera size').toBeLessThan(big.length / 2);
    } finally {
      try { await removeUnpaid(appt.id); } catch { /* already gone */ }
    }
  });
});
