// @ts-check
import { test, expect, request } from 'playwright/test';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { selfPayTypeId } from './helpers/patients.js';

// Module 9 (Laboratory Staff) coverage. The worklist UI (start-processing, template-assisted
// findings entry, confirm-before-release) was already built; the real gap found on inspection
// was that POST /results/:visitTestId/release — which triggers the patient email notification
// and is the actual "release" half of the clinically-significant action — was never called
// anywhere in the frontend. The "Authorize & Release Result" button only recorded findings.
// Also added: client-side validation on the optional attachment URL (the source-side
// complement to the render-side guard added in Module 6).
//
// NOT fixed here (was Module 16's, not this module's, to fix) — recorded as an escalation in
// .agents/TRACEABILITY.md at the time: resultController.js/resultService.js authorized any
// diagnostic staff role for any category via direct API calls, with no check that a Laboratory
// Staff account was only acting on Laboratory-category visit_tests. Since fixed by Module 16 —
// see diagnostic-result-layer.spec.js for that coverage.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const LAB_STAFF = { email: 'lab@enlogada.com', password: 'Password123!' };
const CLIENT = { email: 'client@enlogada.com', password: 'Password123!' };

function uniqueName(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

async function createLabVisitTest(apiContext, recToken) {
  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${recToken}` },
    // Self Pay by name — see the note in helpers/patients.js on why the old hardcoded `2` broke.
    data: { patientTypeId: await selfPayTypeId(apiContext, API, recToken), firstName: 'M9', lastName: uniqueName('Fixture'), birthdate: '1990-01-01', sex: 'Male', address: 'Addr', contactNumber: '09170000000', emergencyContact: '' },
  });
  const patient = (await patientRes.json()).data.patient;

  const visitRes = await apiContext.post(`${API}/visits`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientId: patient.id, visitType: 'Walk in', notes: '' },
  });
  const visit = (await visitRes.json()).data.visit;

  const testsRes = await apiContext.get(`${API}/tests`);
  const labTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Laboratory');

  const vtRes = await apiContext.post(`${API}/tests/visit-tests`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientVisitId: visit.id, testIds: [labTest.id] },
  });
  const visitTestId = (await vtRes.json()).data.visitTests[0].id;


  // Ticket-release gating: a walk-in reaches a modality worklist only once payment is
  // confirmed. Without this the fixture builds a visit that is correctly invisible to
  // diagnostic staff, and every assertion below would fail for the right reason.
  await payAndReleaseWalkIn(apiContext, API, visit.id);

  return { patient, visit, visitTestId };
}

test.describe('Laboratory worklist (API)', () => {
  let apiContext;
  let recToken;
  let labToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginAs(apiContext, RECEPTIONIST);
    labToken = await loginAs(apiContext, LAB_STAFF);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('a new Laboratory visit_test appears in the pending worklist', async () => {
    const { visitTestId } = await createLabVisitTest(apiContext, recToken);
    const res = await apiContext.get(`${API}/results/pending/Laboratory`, { headers: { Authorization: `Bearer ${labToken}` } });
    expect(res.status()).toBe(200);
    const pending = (await res.json()).data.pending;
    expect(pending.some((p) => p.visit_test_id === visitTestId)).toBeTruthy();
  });

  test('uploading then releasing marks the result Completed with findings, visible via history', async () => {
    const { patient, visitTestId } = await createLabVisitTest(apiContext, recToken);

    const uploadRes = await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: { Authorization: `Bearer ${labToken}` },
      data: { findings: 'CBC within normal limits.', remarks: '', fileUrl: null },
    });
    expect(uploadRes.status()).toBe(201);

    const releaseRes = await apiContext.post(`${API}/results/${visitTestId}/release`, {
      headers: { Authorization: `Bearer ${labToken}` },
    });
    expect(releaseRes.status()).toBe(200);

    const historyRes = await apiContext.get(`${API}/results/history/${patient.id}`, { headers: { Authorization: `Bearer ${labToken}` } });
    const results = (await historyRes.json()).data.results;
    const item = results.find((r) => r.visit_test_id === visitTestId);
    expect(item.test_status).toBe('Completed');
    expect(item.findings).toBe('CBC within normal limits.');
  });

  test('a completed test no longer appears in the pending worklist', async () => {
    const { visitTestId } = await createLabVisitTest(apiContext, recToken);
    await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: { Authorization: `Bearer ${labToken}` },
      data: { findings: 'Done.', remarks: '', fileUrl: null },
    });
    await apiContext.post(`${API}/results/${visitTestId}/release`, { headers: { Authorization: `Bearer ${labToken}` } });

    const res = await apiContext.get(`${API}/results/pending/Laboratory`, { headers: { Authorization: `Bearer ${labToken}` } });
    const pending = (await res.json()).data.pending;
    expect(pending.some((p) => p.visit_test_id === visitTestId)).toBeFalsy();
  });

  test('a Client role cannot reach the Laboratory worklist endpoint', async () => {
    const clientToken = await loginAs(apiContext, CLIENT);
    const res = await apiContext.get(`${API}/results/pending/Laboratory`, { headers: { Authorization: `Bearer ${clientToken}` } });
    expect(res.status()).toBe(403);
  });

  test('unauthenticated worklist request is rejected', async () => {
    const res = await apiContext.get(`${API}/results/pending/Laboratory`);
    expect(res.status()).toBe(401);
  });
});

test.describe('Laboratory — browser flow', () => {
  test('an unsafe attachment URL is rejected client-side before submission', async ({ page }) => {
    const apiContext = await request.newContext();
    const recToken = await loginAs(apiContext, RECEPTIONIST);
    const { patient } = await createLabVisitTest(apiContext, recToken);
    // The fixture's payment already released this ticket, which is what sets it to
    // 'Processing'. The explicit status PUT that used to sit here is now both redundant and
    // forbidden — diagnostic staff may no longer set 'Processing' themselves.
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', LAB_STAFF.email);
    await page.fill('input[type="password"]', LAB_STAFF.password);
    await page.locator('button[type="submit"]').click();
    // UI/UX Phase 2: the worklist is now paginated (10/page) against a queue that has
    // accumulated hundreds of entries over this test suite's lifetime, so a freshly created
    // entry isn't guaranteed to land on page 1 — search narrows it down first, same as a real
    // user would.
    await page.getByPlaceholder('Search patient, test, queue...').fill(patient.last_name);
    await expect(page.getByText(`M9 ${patient.last_name}`)).toBeVisible({ timeout: 10000 });

    const row1 = page.getByText(`M9 ${patient.last_name}`).locator('xpath=ancestor::tr[1]');
    await row1.getByRole('button', { name: 'Record Findings' }).click();
    await page.locator('textarea').fill('Findings text.');

    // The free-text attachment URL field this test used to drive was replaced by a real file
    // upload, so the unsafe-attachment guard is now a MIME allowlist rather than URL parsing.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'payload.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<script>alert(1)</script>')
    });
    await expect(page.getByText('Unsupported file type')).toBeVisible();
  });

  test('recording findings and releasing removes the test from the worklist', async ({ page }) => {
    const apiContext = await request.newContext();
    const recToken = await loginAs(apiContext, RECEPTIONIST);
    const { patient } = await createLabVisitTest(apiContext, recToken);
    // The fixture's payment already released this ticket, which is what sets it to
    // 'Processing'. The explicit status PUT that used to sit here is now both redundant and
    // forbidden — diagnostic staff may no longer set 'Processing' themselves.
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', LAB_STAFF.email);
    await page.fill('input[type="password"]', LAB_STAFF.password);
    await page.locator('button[type="submit"]').click();
    // UI/UX Phase 2: search narrows the paginated worklist down to this specific patient.
    await page.getByPlaceholder('Search patient, test, queue...').fill(patient.last_name);
    await expect(page.getByText(`M9 ${patient.last_name}`)).toBeVisible({ timeout: 10000 });

    const row2 = page.getByText(`M9 ${patient.last_name}`).locator('xpath=ancestor::tr[1]');
    await row2.getByRole('button', { name: 'Record Findings' }).click();
    await page.locator('textarea').fill('Normal CBC findings.');
    await page.getByRole('button', { name: 'Authorize & Release Result' }).click();
    await page.getByRole('button', { name: 'Authorize & Release' }).click();

    // Scoped to the worklist table, not the page: releasing opens the printable
    // certificate dialog, which legitimately still shows the patient's name.
    await expect(
      page.locator('table').getByText(`M9 ${patient.last_name}`)
    ).toHaveCount(0, { timeout: 10000 });
  });
});
