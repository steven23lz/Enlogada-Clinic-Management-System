// @ts-check
import { test, expect, request } from 'playwright/test';

// Module 4 (Patient Management) coverage — editing an own patient profile.
// Create and view were already working; this module added Edit only (backend endpoint and
// its ownership check pre-existed — see the Module 4 report).

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

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
      firstName: 'Original',
      lastName: `${prefix}Patient`,
      birthdate: '1990-01-01',
      sex: 'Male',
      address: 'Original Address',
      contactNumber: '09170000000',
      emergencyContact: '09171111111',
    },
  });
  const patientId = (await patientRes.json()).data.patient.id;
  return { email, token, patientId };
}

test.describe('Patient profile editing — ownership (API)', () => {
  let apiContext;
  let clientA;
  let clientB;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    clientA = await registerClientWithPatient(apiContext, 'PatA');
    clientB = await registerClientWithPatient(apiContext, 'PatB');
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('client can edit their own patient profile', async () => {
    const res = await apiContext.put(`${API}/patients/${clientA.patientId}`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
      data: {
        patientTypeId: 2,
        firstName: 'Updated',
        lastName: 'PatAPatient',
        birthdate: '1990-01-01',
        sex: 'Male',
        address: 'New Address 456',
        contactNumber: '09179999999',
        emergencyContact: '09171111111',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.patient.first_name).toBe('Updated');
    expect(body.data.patient.address).toBe('New Address 456');
  });

  test('client CANNOT edit another client\'s patient profile (IDOR regression)', async () => {
    const res = await apiContext.put(`${API}/patients/${clientB.patientId}`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
      data: {
        patientTypeId: 2,
        firstName: 'Malicious',
        lastName: 'Edit',
        birthdate: '1990-01-01',
        sex: 'Male',
        address: 'Attacker Address',
        contactNumber: '09170000000',
        emergencyContact: '',
      },
    });
    expect(res.status()).toBe(403);
  });

  test('editing with missing required fields is rejected with 400', async () => {
    const res = await apiContext.put(`${API}/patients/${clientA.patientId}`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
      data: { firstName: 'Only First Name' },
    });
    expect(res.status()).toBe(400);
  });

  test('unauthenticated edit request is rejected', async () => {
    const res = await apiContext.put(`${API}/patients/${clientA.patientId}`, {
      data: { patientTypeId: 2, firstName: 'X', lastName: 'Y', birthdate: '1990-01-01', sex: 'Male' },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('Patient profile editing — browser flow', () => {
  test('editing a profile via the UI persists the change and pre-fills correctly', async ({ page }) => {
    const apiContext = await request.newContext();
    const client = await registerClientWithPatient(apiContext, 'UIEdit');
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', client.email);
    await page.fill('input[type="password"]', 'TestPass123!');
    await page.locator('button[type="submit"]').click();
    // UI/UX Phase 1: Patient Profile Summary moved from an always-visible sidebar card into
    // its own Profile tab.
    await page.getByRole('tab', { name: 'Profile', exact: true }).click();
    await expect(page.getByText('Patient Profile Summary')).toBeVisible({ timeout: 10000 });

    await page.getByLabel('Edit patient profile').click();
    await expect(page.getByText('Edit Patient Profile', { exact: true })).toBeVisible();

    // Pre-fill check: the existing address should already be in the input, not blank.
    const addressInput = page.locator('input[placeholder="Barangay, City, Province"]');
    await expect(addressInput).toHaveValue('Original Address');

    await addressInput.fill('');
    await addressInput.fill('Playwright-Updated Address');
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.getByText('Edit Patient Profile', { exact: true })).toHaveCount(0, { timeout: 10000 });
  });
});
