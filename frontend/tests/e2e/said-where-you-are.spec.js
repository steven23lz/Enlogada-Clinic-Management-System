// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInOnPhone } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { appointmentForm, removeUnpaid } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { PNG, ensureMethod } from './helpers/payments.js';

/**
 * A refusal is said where the patient is looking. [1.173.0]
 *
 * Steven, on his own phone through a tunnel: "when i send it nothing happens". The proof form said
 * why ("Enter the reference number…", or that the upload never reached the clinic) at the TOP of the
 * form, and on a phone the patient is at the bottom, on Send for verification. Nothing reached the
 * server, and nothing on screen changed. The message now sits beside the button and is brought into
 * view, for a missing reference and for an upload the connection dropped.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

test.use({ viewport: { width: 390, height: 844 } });

test('on a phone, Send for verification that cannot send says why, beside the button', async ({ page }) => {
  test.setTimeout(90000);
  const ctx = await request.newContext();
  const superAdmin = (await (await ctx.post(`${API}/auth/login`, { data: { email: 'admin@enlogada.com', password: PASSWORD } })).json()).data.token;
  await ensureMethod(ctx, superAdmin);
  const usTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests.find((t) => t.category_name === 'Ultrasound' && t.is_active);

  const person = fixturePerson();
  const email = fixtureEmail(person);
  const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
  const patient = (await (await ctx.post(`${API}/patients`, {
    headers: auth(token),
    data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1990-01-01', sex: 'Male', contactNumber: FIXTURE_CONTACT },
  })).json()).data.patient;
  const booked = await ctx.post(`${API}/appointments`, {
    headers: auth(token),
    multipart: appointmentForm({ patientId: patient.id, scheduledDate: nthWorkingDay(251), scheduledTime: '09:30', testIds: [usTest.id] }),
  });
  expect(booked.status(), await booked.text()).toBe(201);
  const appt = (await booked.json()).data.appointment;
  const visitId = appt.patient_visit_id;

  try {
    await signInOnPhone(page, email, PASSWORD);
    await openPortalTab(page, 'appointments');
    await page.getByTestId('final-tests-check').first().getByRole('checkbox', { name: 'These are the tests I want.' }).check();
    // A picture with no text on it: the reader fills no reference, as it did on Steven's phone.
    await page.locator(`#proof-${visitId}`).setInputFiles({ name: 'gcash.png', mimeType: 'image/png', buffer: PNG });
    const send = page.getByRole('button', { name: 'Send for verification' });
    await send.scrollIntoViewIfNeeded();

    await send.click();
    const said = page.getByTestId('pay-error');
    await expect(said).toContainText('Enter the reference number');
    await expect(said, 'in sight, not at the top of the form').toBeInViewport();
    await expect(send, 'and the button with it').toBeInViewport();

    // The upload drops on the way: said beside the button too, and nothing was sent.
    await page.getByLabel('Reference number').first().fill(`SAID${Date.now()}`);
    await page.route('**/api/payment-submissions', (route) => (route.request().method() === 'POST' ? route.abort('connectionreset') : route.continue()), { times: 1 });
    await send.scrollIntoViewIfNeeded();
    await send.click();
    await expect(said).toContainText("couldn't reach the clinic", { timeout: 15000 });
    await expect(said).toBeInViewport();
    const proofs = (await (await ctx.get(`${API}/payment-submissions/visit/${visitId}`, { headers: auth(token) })).json()).data.submissions;
    expect(proofs, 'nothing reached the clinic').toHaveLength(0);
  } finally {
    await removeUnpaid(appt.id);
    await ctx.dispose();
  }
});
