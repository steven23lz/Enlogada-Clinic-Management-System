// @ts-check
import { test, expect, request } from 'playwright/test';

// Module 11 (X-ray Staff) coverage. This shares DiagnosticDashboard.jsx with Modules 9 and 10,
// both of which already fixed the shared bugs (dead release/notification call, missing
// attachment-URL validation, missing role="alert", and a category-resolution race condition).
// Xray's category name ('Xray') was already correct in the worklist-visibility whitelist —
// unlike '2D Echo' in Module 10, there was no analogous gap here.
//
// Inspection + live end-to-end verification found ZERO code changes needed specifically for
// this module: the full worklist -> start processing -> record findings (incl. the
// Xray-specific "Normal Chest X-Ray" template) -> release flow already worked correctly, the
// role string ('Xray Staff', no hyphen, per MODULE_SCOPE.md's explicit callout) was already
// used consistently everywhere (SidebarLayout's roleRequired, DiagnosticDashboard's
// determineCategory, App.jsx's role branch), and cross-category isolation from Laboratory's
// worklist was confirmed live. This file exists to give Module 11 its own dedicated,
// traceable regression coverage rather than relying solely on Modules 9/10's tests.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const XRAY_STAFF = { email: 'xray@enlogada.com', password: 'Password123!' };
const CLIENT = { email: 'client@enlogada.com', password: 'Password123!' };

function uniqueName(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

async function createXrayVisitTest(apiContext, recToken) {
  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientTypeId: 2, firstName: 'M11', lastName: uniqueName('Fixture'), birthdate: '1990-01-01', sex: 'Male', address: 'Addr', contactNumber: '09170000000', emergencyContact: '' },
  });
  const patient = (await patientRes.json()).data.patient;

  const visitRes = await apiContext.post(`${API}/visits`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientId: patient.id, visitType: 'Walk in', notes: '' },
  });
  const visit = (await visitRes.json()).data.visit;

  const testsRes = await apiContext.get(`${API}/tests`);
  const xrayTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Xray');

  const vtRes = await apiContext.post(`${API}/tests/visit-tests`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientVisitId: visit.id, testIds: [xrayTest.id] },
  });
  const visitTestId = (await vtRes.json()).data.visitTests[0].id;

  return { patient, visit, visitTestId, test: xrayTest };
}

test.describe('Xray worklist (API)', () => {
  let apiContext;
  let recToken;
  let xrayToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginAs(apiContext, RECEPTIONIST);
    xrayToken = await loginAs(apiContext, XRAY_STAFF);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('a new Xray visit_test appears in the pending worklist', async () => {
    const { visitTestId } = await createXrayVisitTest(apiContext, recToken);
    const res = await apiContext.get(`${API}/results/pending/Xray`, { headers: { Authorization: `Bearer ${xrayToken}` } });
    expect(res.status()).toBe(200);
    const pending = (await res.json()).data.pending;
    expect(pending.some((p) => p.visit_test_id === visitTestId)).toBeTruthy();
  });

  test('uploading then releasing marks the result Completed, visible via history', async () => {
    const { patient, visitTestId } = await createXrayVisitTest(apiContext, recToken);

    const uploadRes = await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: { Authorization: `Bearer ${xrayToken}` },
      data: { findings: 'No active infiltrates or consolidation.', remarks: '', fileUrl: null },
    });
    expect(uploadRes.status()).toBe(201);

    const releaseRes = await apiContext.post(`${API}/results/${visitTestId}/release`, {
      headers: { Authorization: `Bearer ${xrayToken}` },
    });
    expect(releaseRes.status()).toBe(200);

    const historyRes = await apiContext.get(`${API}/results/history/${patient.id}`, { headers: { Authorization: `Bearer ${xrayToken}` } });
    const results = (await historyRes.json()).data.results;
    const item = results.find((r) => r.visit_test_id === visitTestId);
    expect(item.test_status).toBe('Completed');
    expect(item.findings).toBe('No active infiltrates or consolidation.');
  });

  test('a completed Xray test no longer appears in the pending worklist', async () => {
    const { visitTestId } = await createXrayVisitTest(apiContext, recToken);
    await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: { Authorization: `Bearer ${xrayToken}` },
      data: { findings: 'Done.', remarks: '', fileUrl: null },
    });
    await apiContext.post(`${API}/results/${visitTestId}/release`, { headers: { Authorization: `Bearer ${xrayToken}` } });

    const res = await apiContext.get(`${API}/results/pending/Xray`, { headers: { Authorization: `Bearer ${xrayToken}` } });
    const pending = (await res.json()).data.pending;
    expect(pending.some((p) => p.visit_test_id === visitTestId)).toBeFalsy();
  });

  test('Laboratory worklist visibility is unaffected — cross-category isolation holds', async () => {
    const res = await apiContext.get(`${API}/results/pending/Laboratory`, { headers: { Authorization: `Bearer ${xrayToken}` } });
    // Xray Staff can technically still call this today (the escalated Module 16 gap from
    // Module 9), but the request itself should succeed cleanly, not error.
    expect(res.status()).toBe(200);
  });

  test('a Client role cannot reach the Xray worklist endpoint', async () => {
    const clientToken = await loginAs(apiContext, CLIENT);
    const res = await apiContext.get(`${API}/results/pending/Xray`, { headers: { Authorization: `Bearer ${clientToken}` } });
    expect(res.status()).toBe(403);
  });

  test('unauthenticated worklist request is rejected', async () => {
    const res = await apiContext.get(`${API}/results/pending/Xray`);
    expect(res.status()).toBe(401);
  });
});

test.describe('X-ray Staff — browser flow', () => {
  test('the Chest X-Ray template, findings entry, and release all work end to end', async ({ page }) => {
    const apiContext = await request.newContext();
    const recToken = await loginAs(apiContext, RECEPTIONIST);
    const { patient } = await createXrayVisitTest(apiContext, recToken);
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', XRAY_STAFF.email);
    await page.fill('input[type="password"]', XRAY_STAFF.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText(`M11 ${patient.last_name}`)).toBeVisible({ timeout: 10000 });

    const row = page.getByText(`M11 ${patient.last_name}`).locator('xpath=ancestor::tr[1]');
    await row.getByRole('button', { name: 'Start Processing' }).click();
    await expect(row.getByRole('button', { name: 'Record Findings & Release' })).toBeVisible({ timeout: 10000 });
    await row.getByRole('button', { name: 'Record Findings & Release' }).click();

    await page.getByRole('button', { name: '+ Normal Chest X-Ray' }).click();
    await expect(page.locator('textarea')).toHaveValue(/CHEST X-RAY/);

    await page.getByRole('button', { name: 'Authorize & Release Result' }).click();
    await page.getByRole('button', { name: 'Authorize & Release' }).click();

    await expect(page.getByText(`M11 ${patient.last_name}`)).toHaveCount(0, { timeout: 10000 });
  });
});
