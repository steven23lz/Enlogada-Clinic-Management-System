// @ts-check
import { test, expect, request } from 'playwright/test';

// Module 3 (Appointment) coverage — booking, viewing, and cancelling own appointments,
// plus regression tests for the two ownership/IDOR fixes made in this module's pass
// (appointmentService.createAppointment / cancelAppointment previously trusted the caller
// without verifying the patient belonged to them).

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const CLIENT_EMAIL = 'client@enlogada.com';
const CLIENT_PASSWORD = 'Password123!';

function uniqueEmail(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}@enlogada-e2e.test`;
}

async function registerClientWithPatient(apiContext, prefix) {
  const email = uniqueEmail(prefix);
  const password = 'TestPass123!';
  await apiContext.post(`${API}/auth/register`, {
    data: { firstName: 'E2E', lastName: prefix, email, password, contactNumber: '09170000000' },
  });
  const loginRes = await apiContext.post(`${API}/auth/login`, { data: { email, password } });
  const token = (await loginRes.json()).data.token;

  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      patientTypeId: 2,
      firstName: 'E2E',
      lastName: `${prefix}Patient`,
      birthdate: '1990-01-01',
      sex: 'Male',
      address: 'Test Address',
      contactNumber: '09170000000',
      emergencyContact: '09171111111',
    },
  });
  const patientId = (await patientRes.json()).data.patient.id;
  return { token, patientId };
}

async function findAvailableSlot(apiContext, token) {
  for (let offset = 1; offset <= 14; offset++) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const res = await apiContext.get(`${API}/appointments/availability?date=${dateStr}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (body.data.isOpen) {
      const slot = body.data.slots.find((s) => s.available);
      if (slot) return { scheduledDate: dateStr, scheduledTime: slot.time };
    }
  }
  throw new Error('No available slot found in the next 14 days');
}

test.describe('Appointment booking/cancellation — ownership (API)', () => {
  let apiContext;
  let clientA;
  let clientB;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    clientA = await registerClientWithPatient(apiContext, 'ApptA');
    clientB = await registerClientWithPatient(apiContext, 'ApptB');
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('client CANNOT create an appointment for another client\'s patient (IDOR regression)', async () => {
    const slot = await findAvailableSlot(apiContext, clientA.token);
    const res = await apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
      data: { patientId: clientB.patientId, ...slot, notes: 'malicious cross-account booking attempt' },
    });
    expect(res.status()).toBe(403);
  });

  test('client can create an appointment for their own patient', async () => {
    const slot = await findAvailableSlot(apiContext, clientA.token);
    const res = await apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
      data: { patientId: clientA.patientId, ...slot, notes: 'own booking' },
    });
    expect(res.status()).toBe(201);
  });

  test('client CANNOT cancel another client\'s appointment (IDOR regression)', async () => {
    const slot = await findAvailableSlot(apiContext, clientB.token);
    const bookRes = await apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientB.token}` },
      data: { patientId: clientB.patientId, ...slot, notes: 'clientB own booking' },
    });
    const appointment = (await bookRes.json()).data.appointment;

    const cancelRes = await apiContext.put(`${API}/appointments/${appointment.id}/cancel`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
    });
    expect(cancelRes.status()).toBe(403);
  });

  test('client can cancel their own appointment', async () => {
    const slot = await findAvailableSlot(apiContext, clientA.token);
    const bookRes = await apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
      data: { patientId: clientA.patientId, ...slot, notes: 'to be cancelled' },
    });
    const appointment = (await bookRes.json()).data.appointment;

    const cancelRes = await apiContext.put(`${API}/appointments/${appointment.id}/cancel`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
    });
    expect(cancelRes.status()).toBe(200);

    // Cancelling again is rejected with a clean error, not a crash.
    const secondCancelRes = await apiContext.put(`${API}/appointments/${appointment.id}/cancel`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
    });
    expect(secondCancelRes.status()).toBe(400);
  });

  test('unauthenticated requests to create/cancel are rejected', async () => {
    const createRes = await apiContext.post(`${API}/appointments`, {
      data: { patientId: clientA.patientId, scheduledDate: '2027-01-01', scheduledTime: '09:00' },
    });
    expect(createRes.status()).toBe(401);

    const cancelRes = await apiContext.put(`${API}/appointments/1/cancel`);
    expect(cancelRes.status()).toBe(401);
  });
});

test.describe('Appointment booking/cancellation — browser flow', () => {
  test('My Appointments card is visible on the Client dashboard', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', CLIENT_EMAIL);
    await page.fill('input[type="password"]', CLIENT_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('My Appointments', { exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('cancelling an appointment via the UI updates its status to Cancelled', async ({ page }) => {
    // Seed a fresh cancellable appointment via the API so this test doesn't depend on
    // the booking wizard's exact UI flow (covered separately by manual/API tests above).
    const apiContext = await request.newContext();
    const loginRes = await apiContext.post(`${API}/auth/login`, { data: { email: CLIENT_EMAIL, password: CLIENT_PASSWORD } });
    const token = (await loginRes.json()).data.token;
    const profilesRes = await apiContext.get(`${API}/patients/my-profiles`, { headers: { Authorization: `Bearer ${token}` } });
    const patientId = (await profilesRes.json()).data.patients[0].id;
    const slot = await findAvailableSlot(apiContext, token);
    const bookRes = await apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { patientId, ...slot, notes: 'UI cancel test' },
    });
    const appointment = (await bookRes.json()).data.appointment;
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', CLIENT_EMAIL);
    await page.fill('input[type="password"]', CLIENT_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText(appointment.appointment_reference)).toBeVisible({ timeout: 10000 });

    const card = page.locator('div', { has: page.getByText(appointment.appointment_reference) }).last();
    await card.getByRole('button', { name: 'Cancel Appointment' }).click();
    await page.getByRole('button', { name: 'Cancel Appointment' }).last().click();

    await expect(page.getByText('Cancelled').first()).toBeVisible({ timeout: 10000 });
    // No "Invalid Date" regression (see module report) and the reference stays visible.
    await expect(page.getByText('Invalid Date')).toHaveCount(0);
    await expect(page.getByText(appointment.appointment_reference)).toBeVisible();
  });
});
