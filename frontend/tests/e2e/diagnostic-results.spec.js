// @ts-check
import { test, expect, request } from 'playwright/test';

// Module 6 (Diagnostic Result Viewing) coverage — a client's read-only access to their own
// released test_results. IDOR/ownership on GET /results/history/:patientId is already
// regression-tested in api-authorization.spec.js; this file covers what's specific to this
// module: correct pending-vs-completed shape, and the ClientDashboard.jsx rendering fixes made
// for this module (React key bug, missing category filter tabs, unsafe file_url as a link).

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const LAB_STAFF_EMAIL = 'lab@enlogada.com';
const LAB_STAFF_PASSWORD = 'Password123!';

function uniqueEmail(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}@enlogada-e2e.test`;
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

async function registerClientWithPatientAndVisit(apiContext, prefix, testCategoryNames) {
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

  const testsRes = await apiContext.get(`${API}/tests`);
  const allTests = (await testsRes.json()).data.tests;
  const chosenTests = testCategoryNames.map((cat) => allTests.find((t) => t.category_name === cat));

  const slot = await findAvailableSlot(apiContext, token);
  const apptRes = await apiContext.post(`${API}/appointments`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { patientId, ...slot, notes: 'e2e fixture' },
  });
  const appt = (await apptRes.json()).data.appointment;

  const visitTestsRes = await apiContext.post(`${API}/tests/visit-tests`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { patientVisitId: appt.patient_visit_id, testIds: chosenTests.map((t) => t.id) },
  });
  const visitTests = (await visitTestsRes.json()).data.visitTests;

  return { email, token, patientId, chosenTests, visitTests };
}

async function loginLabStaff(apiContext) {
  const res = await apiContext.post(`${API}/auth/login`, { data: { email: LAB_STAFF_EMAIL, password: LAB_STAFF_PASSWORD } });
  return (await res.json()).data.token;
}

test.describe('Diagnostic result history — API shape', () => {
  let apiContext;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('a test with no uploaded result shows Pending status and null findings/file_url', async () => {
    const client = await registerClientWithPatientAndVisit(apiContext, 'M6Pending', ['Laboratory']);
    const res = await apiContext.get(`${API}/results/history/${client.patientId}`, {
      headers: { Authorization: `Bearer ${client.token}` },
    });
    expect(res.status()).toBe(200);
    const results = (await res.json()).data.results;
    expect(results.length).toBe(1);
    expect(results[0].test_status).toBe('Pending');
    expect(results[0].findings).toBeNull();
    expect(results[0].file_url).toBeNull();
  });

  test('after staff upload + release, the client sees Completed status with findings', async () => {
    const client = await registerClientWithPatientAndVisit(apiContext, 'M6Completed', ['Laboratory']);
    const staffToken = await loginLabStaff(apiContext);
    const visitTestId = client.visitTests[0].id;

    await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: { Authorization: `Bearer ${staffToken}` },
      data: { fileUrl: 'https://example.com/report.pdf', findings: 'Normal.', remarks: '' },
    });
    await apiContext.post(`${API}/results/${visitTestId}/release`, {
      headers: { Authorization: `Bearer ${staffToken}` },
    });

    const res = await apiContext.get(`${API}/results/history/${client.patientId}`, {
      headers: { Authorization: `Bearer ${client.token}` },
    });
    const results = (await res.json()).data.results;
    expect(results[0].test_status).toBe('Completed');
    expect(results[0].findings).toBe('Normal.');
    expect(results[0].file_url).toBe('https://example.com/report.pdf');
  });
});

test.describe('Diagnostic result history — browser flow', () => {
  test('all 5 categories are filterable, results render with correct keys, and an unsafe file_url is never a clickable link', async ({ page }) => {
    const apiContext = await request.newContext();
    const client = await registerClientWithPatientAndVisit(apiContext, 'M6UI', ['Laboratory', '2D Echo']);
    const staffToken = await loginLabStaff(apiContext);

    const labVisitTestId = client.visitTests.find((vt) => vt.test_id === client.chosenTests[0].id).id;
    const echoVisitTestId = client.visitTests.find((vt) => vt.test_id === client.chosenTests[1].id).id;

    // Malicious file_url on one result — this is what the render-side guard must neutralize.
    await apiContext.post(`${API}/results/${labVisitTestId}`, {
      headers: { Authorization: `Bearer ${staffToken}` },
      data: { fileUrl: 'javascript:alert(document.cookie)', findings: 'Finding A', remarks: '' },
    });
    await apiContext.post(`${API}/results/${labVisitTestId}/release`, { headers: { Authorization: `Bearer ${staffToken}` } });

    await apiContext.post(`${API}/results/${echoVisitTestId}`, {
      headers: { Authorization: `Bearer ${staffToken}` },
      data: { fileUrl: 'https://example.com/echo.pdf', findings: 'Finding B', remarks: '' },
    });
    await apiContext.post(`${API}/results/${echoVisitTestId}/release`, { headers: { Authorization: `Bearer ${staffToken}` } });
    await apiContext.dispose();

    const consoleIssues = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if ((msg.type() === 'warning' || msg.type() === 'error') && text.toLowerCase().includes('key') && !text.includes('GSI_LOGGER')) {
        consoleIssues.push(text);
      }
    });

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', client.email);
    await page.fill('input[type="password"]', 'TestPass123!');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Enlogada Diagnostic Patient Portal')).toBeVisible({ timeout: 10000 });

    // All 5 real categories are filterable (previously only 3 of 5 existed).
    await expect(page.getByRole('button', { name: 'Laboratory', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ultrasound', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xray', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '2D Echo', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ECG', exact: true })).toBeVisible();

    // Filtering to 2D Echo hides the Laboratory result and shows the Echo one.
    await page.getByRole('button', { name: '2D Echo', exact: true }).click();
    await expect(page.getByText('2D Echo -', { exact: false })).toBeVisible();
    await expect(page.getByText('Laboratory -', { exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: 'All', exact: true }).click();

    // No React duplicate/missing-key warnings when rendering a multi-item history list.
    expect(consoleIssues).toEqual([]);

    // Open the Laboratory report (the one with the malicious file_url).
    await page.getByRole('button', { name: 'View Certificate Report' }).first().click();
    await expect(page.getByText('CONFIDENTIAL MEDICAL DOCUMENT')).toBeVisible();
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    await expect(page.getByText('Attachment link unavailable')).toBeVisible();
  });
});
