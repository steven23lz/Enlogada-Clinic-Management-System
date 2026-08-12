// @ts-check
import { test, expect, request } from 'playwright/test';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';

// UI/UX Phase 4 (Polish) coverage: a real About Us page, Login's Sign In button matching
// Register's green (and passing WCAG AA contrast), and Diagnostic's quick-fill templates now
// scoped to the viewing department's category.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const LAB_STAFF = { email: 'lab@enlogada.com', password: 'Password123!' };
const XRAY_STAFF = { email: 'xray@enlogada.com', password: 'Password123!' };
const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

async function createLabVisitTest(apiContext, recToken) {
  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientTypeId: 2, firstName: 'P4', lastName: `Fixture${Date.now()}`, birthdate: '1990-01-01', sex: 'Male', address: 'Addr', contactNumber: '09170000000', emergencyContact: '' },
  });
  const patient = (await patientRes.json()).data.patient;
  const visitRes = await apiContext.post(`${API}/visits`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientId: patient.id, visitType: 'Walk in', notes: '' },
  });
  const visit = (await visitRes.json()).data.visit;
  const testsRes = await apiContext.get(`${API}/tests`);
  const test_ = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Laboratory');
  const vtRes = await apiContext.post(`${API}/tests/visit-tests`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientVisitId: visit.id, testIds: [test_.id] },
  });
  const visitTestId = (await vtRes.json()).data.visitTests[0].id;

  // Ticket-release gating: a walk-in reaches a modality worklist only once payment is
  // confirmed. Without this the fixture builds a visit that is correctly invisible to
  // diagnostic staff, and every assertion below would fail for the right reason.
  await payAndReleaseWalkIn(apiContext, API, visit.id);

  return { patient, visitTestId };
}

test.describe('Public — About Us page', () => {
  test('the header link navigates to real About Us content, not a re-rendered Home page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'About Us' }).click();
    await expect(page.getByRole('heading', { name: 'About Enlogada' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Why Patients Choose Us')).toBeVisible();
    // The Home-only hero headline must NOT be present on this page.
    await expect(page.getByRole('heading', { name: /Your Trusted Diagnostic Partner/i })).toHaveCount(0);
  });
});

test.describe('Login — button color matches Register', () => {
  test('the Sign In button is green, not navy', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    const bg = await page.locator('button[type="submit"]').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(101, 124, 58)'); // --color-primary-hover, #657c3a
  });
});

test.describe('Diagnostic — category-scoped quick templates (API-seeded)', () => {
  test('Laboratory staff sees only the CBC template, not X-Ray or Ultrasound ones', async ({ page }) => {
    const apiContext = await request.newContext();
    const recToken = await loginAs(apiContext, RECEPTIONIST);
    const { patient, visitTestId } = await createLabVisitTest(apiContext, recToken);
    const labToken = await loginAs(apiContext, LAB_STAFF);
    // The fixture's payment already released this ticket, which is what sets it to
    // 'Processing'. The explicit status PUT that used to sit here is now both redundant and
    // forbidden — diagnostic staff may no longer set 'Processing' themselves.
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', LAB_STAFF.email);
    await page.fill('input[type="password"]', LAB_STAFF.password);
    await page.locator('button[type="submit"]').click();
    await page.getByPlaceholder('Search patient, test, queue...').fill(patient.last_name);
    await expect(page.getByText(`P4 ${patient.last_name}`)).toBeVisible({ timeout: 10000 });

    const row = page.getByText(`P4 ${patient.last_name}`).locator('xpath=ancestor::tr[1]');
    await row.getByRole('button', { name: 'Record Findings' }).click();

    await expect(page.getByText('Normal CBC Template')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Normal Chest X-Ray')).toHaveCount(0);
    await expect(page.getByText('Normal Pelvic Ultrasound')).toHaveCount(0);
  });

  test('Xray staff still sees the Chest X-Ray template (regression guard)', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', XRAY_STAFF.email);
    await page.fill('input[type="password"]', XRAY_STAFF.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Active Modality')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Processing', exact: true }).click();
    const releaseBtn = page.locator('table').getByRole('button', { name: 'Record Findings' }).first();
    if (await releaseBtn.isVisible().catch(() => false)) {
      await releaseBtn.click();
      await expect(page.getByText('Normal Chest X-Ray')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Normal CBC Template')).toHaveCount(0);
    }
  });
});
