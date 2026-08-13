// @ts-check
import { test, expect, request } from 'playwright/test';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';

// Module 10 (Ultrasound Staff) coverage. This shares DiagnosticDashboard.jsx with Modules 9
// and 11; Module 9 already fixed the release-notification wiring and attachment URL
// validation, which apply here too. This module's own gap, found on inspection:
//
// MODULE_SCOPE.md defines Module 10 as "Ultrasound-category (including 2D Echo)", but
// '2D Echo' is a separate row in test_categories, and the backend's worklist-visibility
// whitelist (resultService.getPendingByCategory) only accepted Laboratory/Xray/Ultrasound —
// a hard 400 rejection, not just a missing filter. That meant no staff member could ever
// discover a pending 2D Echo test through any worklist. Fixed (per explicit user decision,
// since this required a narrow, mechanical change to Module 16's resultService.js) by adding
// '2D Echo' to the whitelist and merging it into the Ultrasound Staff worklist specifically.
//
// Fixing this also surfaced a real, separate bug: the component fetches once immediately with
// a hardcoded default category, then again once the user's real role resolves — a race where
// whichever response lands last wins. Both fetches used to be equally fast single requests;
// the merged Ultrasound+2D Echo fetch is now a slower double-request, which made the stale
// default ("Laboratory") response win in practice. Fixed by not fetching at all until the real
// category is resolved.
//
// Real file upload (an actual file picker + server-side storage) does not exist anywhere in
// this app for any category — confirmed no upload library is even installed. Per explicit user
// decision, that is a separate, larger cross-module piece of work, not part of this module.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const ULTRASOUND_STAFF = { email: 'ultrasound@enlogada.com', password: 'Password123!' };
const LAB_STAFF = { email: 'lab@enlogada.com', password: 'Password123!' };
const CLIENT = { email: 'client@enlogada.com', password: 'Password123!' };

function uniqueName(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

async function createVisitTest(apiContext, recToken, categoryName) {
  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientTypeId: 2, firstName: 'M10', lastName: uniqueName('Fixture'), birthdate: '1990-01-01', sex: 'Male', address: 'Addr', contactNumber: '09170000000', emergencyContact: '' },
  });
  const patient = (await patientRes.json()).data.patient;

  const visitRes = await apiContext.post(`${API}/visits`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientId: patient.id, visitType: 'Walk in', notes: '' },
  });
  const visit = (await visitRes.json()).data.visit;

  const testsRes = await apiContext.get(`${API}/tests`);
  const test_ = (await testsRes.json()).data.tests.find((t) => t.category_name === categoryName);

  const vtRes = await apiContext.post(`${API}/tests/visit-tests`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientVisitId: visit.id, testIds: [test_.id] },
  });
  const visitTestId = (await vtRes.json()).data.visitTests[0].id;


  // Ticket-release gating: a walk-in reaches a modality worklist only once payment is
  // confirmed. Without this the fixture builds a visit that is correctly invisible to
  // diagnostic staff, and every assertion below would fail for the right reason.
  await payAndReleaseWalkIn(apiContext, API, visit.id);

  return { patient, visit, visitTestId, test: test_ };
}

test.describe('2D Echo worklist visibility (API)', () => {
  let apiContext;
  let recToken;
  let usToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginAs(apiContext, RECEPTIONIST);
    usToken = await loginAs(apiContext, ULTRASOUND_STAFF);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('GET /results/pending/2D Echo no longer 400s (was a hard rejection)', async () => {
    const res = await apiContext.get(`${API}/results/pending/${encodeURIComponent('2D Echo')}`, {
      headers: { Authorization: `Bearer ${usToken}` },
    });
    expect(res.status()).toBe(200);
  });

  test('a new 2D Echo visit_test appears in the 2D Echo pending list', async () => {
    const { visitTestId } = await createVisitTest(apiContext, recToken, '2D Echo');
    const res = await apiContext.get(`${API}/results/pending/${encodeURIComponent('2D Echo')}`, {
      headers: { Authorization: `Bearer ${usToken}` },
    });
    const pending = (await res.json()).data.pending;
    expect(pending.some((p) => p.visit_test_id === visitTestId)).toBeTruthy();
  });

  test('Laboratory worklist visibility is unaffected by the whitelist change', async () => {
    const labToken = await loginAs(apiContext, LAB_STAFF);
    const { visitTestId } = await createVisitTest(apiContext, recToken, 'Laboratory');
    const res = await apiContext.get(`${API}/results/pending/Laboratory`, { headers: { Authorization: `Bearer ${labToken}` } });
    expect(res.status()).toBe(200);
    const pending = (await res.json()).data.pending;
    expect(pending.some((p) => p.visit_test_id === visitTestId)).toBeTruthy();
  });

  test('a Client role cannot reach the Ultrasound worklist endpoint', async () => {
    const clientToken = await loginAs(apiContext, CLIENT);
    const res = await apiContext.get(`${API}/results/pending/Ultrasound`, { headers: { Authorization: `Bearer ${clientToken}` } });
    expect(res.status()).toBe(403);
  });
});

test.describe('Ultrasound Staff — browser flow', () => {
  test('the worklist merges both Ultrasound and 2D Echo tests, and the header reflects it', async ({ page }) => {
    const apiContext = await request.newContext();
    const recToken = await loginAs(apiContext, RECEPTIONIST);
    const { patient: echoPatient } = await createVisitTest(apiContext, recToken, '2D Echo');
    const { patient: usPatient } = await createVisitTest(apiContext, recToken, 'Ultrasound');
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', ULTRASOUND_STAFF.email);
    await page.fill('input[type="password"]', ULTRASOUND_STAFF.password);
    await page.locator('button[type="submit"]').click();

    await expect(page.getByText('Ultrasound (incl. 2D Echo)').first()).toBeVisible({ timeout: 10000 });
    // UI/UX Phase 2: the worklist is now paginated (10/page) against a queue that has
    // accumulated hundreds of entries over this test suite's lifetime, so a freshly created
    // entry isn't guaranteed to land on page 1 — search narrows it down first, same as a real
    // user would. Checked one at a time since each has a distinct unique last name.
    const searchBox = page.getByPlaceholder('Search patient, test, queue...');
    await searchBox.fill(echoPatient.last_name);
    await expect(page.getByText(`M10 ${echoPatient.last_name}`)).toBeVisible({ timeout: 10000 });
    await searchBox.fill(usPatient.last_name);
    await expect(page.getByText(`M10 ${usPatient.last_name}`)).toBeVisible({ timeout: 10000 });
  });

  test('recording findings and releasing a 2D Echo test removes it from the worklist', async ({ page }) => {
    const apiContext = await request.newContext();
    const recToken = await loginAs(apiContext, RECEPTIONIST);
    const { patient } = await createVisitTest(apiContext, recToken, '2D Echo');
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', ULTRASOUND_STAFF.email);
    await page.fill('input[type="password"]', ULTRASOUND_STAFF.password);
    await page.locator('button[type="submit"]').click();
    // UI/UX Phase 2: search narrows the paginated worklist down to this specific patient.
    await page.getByPlaceholder('Search patient, test, queue...').fill(patient.last_name);
    await expect(page.getByText(`M10 ${patient.last_name}`)).toBeVisible({ timeout: 10000 });

    // No "Start Processing" step any more: the ticket arrives already Processing, put there by
    // the release. Diagnostic staff cannot pull work into their own queue.
    const row = page.getByText(`M10 ${patient.last_name}`).locator('xpath=ancestor::tr[1]');
    await expect(row.getByRole('button', { name: 'Start Processing' })).toHaveCount(0);

    await row.getByRole('button', { name: 'Record Findings' }).click();
    await page.locator('textarea').first().fill('Normal pediatric 2D echo findings.');
    await page.getByRole('button', { name: 'Authorize & Release Result' }).click();
    await page.getByRole('button', { name: 'Authorize & Release' }).click();

    // Scoped to the worklist table, not the page: releasing opens the printable
    // certificate dialog, which legitimately still shows the patient's name.
    await expect(
      page.locator('table').getByText(`M10 ${patient.last_name}`)
    ).toHaveCount(0, { timeout: 10000 });
  });
});
