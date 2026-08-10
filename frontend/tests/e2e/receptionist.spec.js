// @ts-check
import { test, expect, request } from 'playwright/test';

// Module 7 (Receptionist) coverage. Most of the dashboard (queue, QR/reference check-in, test
// attachment) was already built and correct; this module's real work was three gaps found on
// inspection:
//   1. HMO request initiation was fully dead code — logic/state existed but no trigger/Dialog
//      was ever rendered.
//   2. The HMO request call hit POST /hmo/requests (plural) while the only registered route is
//      POST /hmo/request (singular) — a 404, in both this dashboard and Module 3's client
//      booking flow.
//   3. There was no patient lookup at all (GET /patients/search did not exist), so every walk-in
//      silently created a duplicate patient record even for a returning patient.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const RECEPTIONIST_EMAIL = 'receptionist@enlogada.com';
const RECEPTIONIST_PASSWORD = 'Password123!';
const CLIENT_EMAIL = 'client@enlogada.com';
const CLIENT_PASSWORD = 'Password123!';

function uniqueName(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

async function loginReceptionist(apiContext) {
  const res = await apiContext.post(`${API}/auth/login`, { data: { email: RECEPTIONIST_EMAIL, password: RECEPTIONIST_PASSWORD } });
  return (await res.json()).data.token;
}

test.describe('Patient lookup (API)', () => {
  let apiContext;
  let recToken;
  let uniqueLastName;
  let patientId;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginReceptionist(apiContext);
    uniqueLastName = uniqueName('Lookup');

    const patientRes = await apiContext.post(`${API}/patients`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientTypeId: 1, firstName: 'Search', lastName: uniqueLastName, birthdate: '1980-01-01', sex: 'Male', address: 'Addr', contactNumber: '09170000000', emergencyContact: '' },
    });
    patientId = (await patientRes.json()).data.patient.id;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('a walk-in patient created by staff has no linked user_id', async () => {
    const res = await apiContext.get(`${API}/patients/${patientId}`, { headers: { Authorization: `Bearer ${recToken}` } });
    const body = await res.json();
    expect(body.data.patient.user_id).toBeNull();
  });

  test('searching by last name finds the patient', async () => {
    const res = await apiContext.get(`${API}/patients/search`, {
      headers: { Authorization: `Bearer ${recToken}` },
      params: { q: uniqueLastName },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.patients.some((p) => p.id === patientId)).toBeTruthy();
  });

  test('a query shorter than 2 characters is rejected with 400', async () => {
    const res = await apiContext.get(`${API}/patients/search`, {
      headers: { Authorization: `Bearer ${recToken}` },
      params: { q: 'a' },
    });
    expect(res.status()).toBe(400);
  });

  test('unauthenticated search is rejected', async () => {
    const res = await apiContext.get(`${API}/patients/search`, { params: { q: uniqueLastName } });
    expect(res.status()).toBe(401);
  });

  test('a Client role cannot reach the staff-only search endpoint', async () => {
    const clientLogin = await apiContext.post(`${API}/auth/login`, { data: { email: CLIENT_EMAIL, password: CLIENT_PASSWORD } });
    const clientToken = (await clientLogin.json()).data.token;
    const res = await apiContext.get(`${API}/patients/search`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      params: { q: uniqueLastName },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('HMO request initiation (API)', () => {
  let apiContext;
  let recToken;
  let visitTestId;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginReceptionist(apiContext);

    const patientRes = await apiContext.post(`${API}/patients`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientTypeId: 1, firstName: 'Hmo', lastName: uniqueName('Fixture'), birthdate: '1980-01-01', sex: 'Male', address: 'Addr', contactNumber: '09170000000', emergencyContact: '' },
    });
    const patientId = (await patientRes.json()).data.patient.id;

    const visitRes = await apiContext.post(`${API}/visits`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientId, visitType: 'Walk in', notes: '' },
    });
    const visitId = (await visitRes.json()).data.visit.id;

    const testsRes = await apiContext.get(`${API}/tests`);
    const labTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Laboratory');

    const vtRes = await apiContext.post(`${API}/tests/visit-tests`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientVisitId: visitId, testIds: [labTest.id] },
    });
    visitTestId = (await vtRes.json()).data.visitTests[0].id;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('POST /hmo/request (the actual registered route) logs the request', async () => {
    const providersRes = await apiContext.get(`${API}/hmo/providers`, { headers: { Authorization: `Bearer ${recToken}` } });
    const providerId = (await providersRes.json()).data.providers[0].id;

    const res = await apiContext.post(`${API}/hmo/request`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { hmoProviderId: providerId, approvalCode: 'LOA-E2E-1', visitTestIds: [visitTestId] },
    });
    expect(res.status()).toBe(201);
  });

  test('the old plural path the UI used to call does not exist (regression guard)', async () => {
    const providersRes = await apiContext.get(`${API}/hmo/providers`, { headers: { Authorization: `Bearer ${recToken}` } });
    const providerId = (await providersRes.json()).data.providers[0].id;

    const res = await apiContext.post(`${API}/hmo/requests`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { hmoProviderId: providerId, approvalCode: 'X', visitTestIds: [visitTestId] },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('Receptionist — browser flow', () => {
  test('an existing patient can be found via lookup and checked in without re-registering', async ({ page }) => {
    const apiContext = await request.newContext();
    const recToken = await loginReceptionist(apiContext);
    const uniqueLastName = uniqueName('UILookup');

    await apiContext.post(`${API}/patients`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientTypeId: 1, firstName: 'Returning', lastName: uniqueLastName, birthdate: '1980-01-01', sex: 'Female', address: 'Addr', contactNumber: '09170000000', emergencyContact: '' },
    });
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', RECEPTIONIST_EMAIL);
    await page.fill('input[type="password"]', RECEPTIONIST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Active Queue Visits')).toBeVisible({ timeout: 10000 });

    // UI/UX Phase 1: "Walk-In Fast Registration" was previously a tab on the same page as the
    // queue; it's now its own nav destination ("Walk-In Registration").
    await page.getByText('Walk-In Registration', { exact: true }).click();
    await page.getByPlaceholder('Search by patient name...').fill(uniqueLastName);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText(`Returning ${uniqueLastName}`)).toBeVisible({ timeout: 10000 });

    // UI/UX Phase 3: this used to check the patient in immediately on click; it now opens a
    // confirmation dialog first (unified with the QR/reference check-in flow's existing
    // confirm-before-firing pattern).
    await page.getByRole('button', { name: /Check In This Patient/ }).click();
    await expect(page.getByText(/as a walk-in\?/)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Confirm Check-In' }).click();
    await expect(page.getByText(/checked in!/)).toBeVisible({ timeout: 10000 });
  });

  test('the HMO logging modal opens from the active queue and submits successfully', async ({ page }) => {
    const apiContext = await request.newContext();
    const recToken = await loginReceptionist(apiContext);

    const patientRes = await apiContext.post(`${API}/patients`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientTypeId: 1, firstName: 'HmoUI', lastName: uniqueName('Fixture'), birthdate: '1980-01-01', sex: 'Male', address: 'Addr', contactNumber: '09170000000', emergencyContact: '' },
    });
    const patientId = (await patientRes.json()).data.patient.id;
    const visitRes = await apiContext.post(`${API}/visits`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientId, visitType: 'Walk in', notes: '' },
    });
    const visitId = (await visitRes.json()).data.visit.id;
    const testsRes = await apiContext.get(`${API}/tests`);
    const labTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Laboratory');
    await apiContext.post(`${API}/tests/visit-tests`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientVisitId: visitId, testIds: [labTest.id] },
    });
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', RECEPTIONIST_EMAIL);
    await page.fill('input[type="password"]', RECEPTIONIST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    // UI/UX Phase 1: Active Queue is now Receptionist's default landing page (no tab needed).
    await expect(page.getByText('Active Queue Visits')).toBeVisible({ timeout: 10000 });

    await page.getByLabel(`Log HMO pre-authorization for ${labTest.name}`).first().click();
    await expect(page.getByText('Log HMO Pre-Authorization')).toBeVisible();

    await page.getByRole('combobox').click();
    await page.getByRole('option').first().click();
    await page.getByPlaceholder('Enter approval or card LOA number').fill('LOA-BROWSER-1');
    await page.getByRole('button', { name: 'Log HMO Request' }).click();
    await expect(page.getByText('HMO Pre-authorization logged successfully!')).toBeVisible({ timeout: 10000 });
  });
});
