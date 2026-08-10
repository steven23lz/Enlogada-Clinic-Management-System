// @ts-check
import { test, expect, request } from 'playwright/test';

// Module 15 (Test and Service Request) coverage. Two real gaps found on inspection, both fixed
// here (this module's own files):
//
// 1. A known IDOR gap, flagged during the pre-implementation remediation pass and deliberately
//    deferred through every module since: POST /tests/visit-tests authorizes the Client role
//    but testService.addTestsToVisit performed zero ownership check — any client could attach
//    (and be billed for) tests on any arbitrary patientVisitId. Fixed with the same
//    assertClientOwnsPatient-shaped guard already established in appointmentService.js.
// 2. The approval half of "HMO request/approval flow" had no UI anywhere, and no "list
//    requests" endpoint existed at all — approval was only reachable if you already knew a
//    specific request ID. Built GET /hmo/requests + a Service Requests admin page (replacing
//    the honest placeholder left in Module 12) with request-level and per-test approval.
//
// Also fixed, per explicit user approval, a direct consequence of Module 14's HMO-coverage fix:
// CashierDashboard.jsx had a banner unconditionally claiming "Full coverage approved" for any
// HMO-category patient, which became actively misleading once coverage started reflecting real
// per-test approval instead of a blanket assumption.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const SUPERADMIN = { email: 'admin@enlogada.com', password: 'Password123!' };

function uniqueEmail(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}@enlogada-e2e.test`;
}

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

async function registerClientWithPatientAndVisit(apiContext, prefix, recToken) {
  const email = uniqueEmail(prefix);
  const password = 'TestPass123!';
  await apiContext.post(`${API}/auth/register`, { data: { firstName: 'E2E', lastName: prefix, email, password, contactNumber: '' } });
  const loginRes = await apiContext.post(`${API}/auth/login`, { data: { email, password } });
  const token = (await loginRes.json()).data.token;

  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { patientTypeId: 2, firstName: 'E2E', lastName: `${prefix}Patient`, birthdate: '1990-01-01', sex: 'Male', address: '', contactNumber: '', emergencyContact: '' },
  });
  const patient = (await patientRes.json()).data.patient;

  const visitRes = await apiContext.post(`${API}/visits`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientId: patient.id, visitType: 'Walk in', notes: '' },
  });
  const visit = (await visitRes.json()).data.visit;

  return { token, patient, visit };
}

test.describe('visit_tests attachment — ownership (API)', () => {
  let apiContext;
  let recToken;
  let clientA;
  let clientB;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginAs(apiContext, RECEPTIONIST);
    clientA = await registerClientWithPatientAndVisit(apiContext, 'M15A', recToken);
    clientB = await registerClientWithPatientAndVisit(apiContext, 'M15B', recToken);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('a client CANNOT attach tests to another client\'s visit (IDOR regression)', async () => {
    const testsRes = await apiContext.get(`${API}/tests`);
    const labTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Laboratory');

    const res = await apiContext.post(`${API}/tests/visit-tests`, {
      headers: { Authorization: `Bearer ${clientB.token}` },
      data: { patientVisitId: clientA.visit.id, testIds: [labTest.id] },
    });
    expect(res.status()).toBe(403);
  });

  test('a client CAN attach tests to their own visit', async () => {
    const testsRes = await apiContext.get(`${API}/tests`);
    const labTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Laboratory');

    const res = await apiContext.post(`${API}/tests/visit-tests`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
      data: { patientVisitId: clientA.visit.id, testIds: [labTest.id] },
    });
    expect(res.status()).toBe(201);
  });

  test('staff (Receptionist) is unaffected by the ownership check — not restricted to any single client', async () => {
    const testsRes = await apiContext.get(`${API}/tests`);
    const xrayTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Xray');

    const res = await apiContext.post(`${API}/tests/visit-tests`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientVisitId: clientA.visit.id, testIds: [xrayTest.id] },
    });
    expect(res.status()).toBe(201);
  });

  test('attaching tests to a nonexistent visit returns 404 for a client caller, not a crash', async () => {
    const testsRes = await apiContext.get(`${API}/tests`);
    const labTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Laboratory');

    const res = await apiContext.post(`${API}/tests/visit-tests`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
      data: { patientVisitId: 999999999, testIds: [labTest.id] },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('HMO request listing and approval (API)', () => {
  let apiContext;
  let recToken;
  let superToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginAs(apiContext, RECEPTIONIST);
    superToken = await loginAs(apiContext, SUPERADMIN);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  async function createPendingHmoRequest(prefix) {
    const { token: clientToken, visit } = await registerClientWithPatientAndVisit(apiContext, prefix, recToken);
    const testsRes = await apiContext.get(`${API}/tests`);
    const ultrasoundTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Ultrasound');
    const vtRes = await apiContext.post(`${API}/tests/visit-tests`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      data: { patientVisitId: visit.id, testIds: [ultrasoundTest.id] },
    });
    const visitTest = (await vtRes.json()).data.visitTests[0];

    const providersRes = await apiContext.get(`${API}/hmo/providers`, { headers: { Authorization: `Bearer ${recToken}` } });
    const providerId = (await providersRes.json()).data.providers[0].id;

    const reqRes = await apiContext.post(`${API}/hmo/request`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { hmoProviderId: providerId, approvalCode: '', visitTestIds: [visitTest.id] },
    });
    return (await reqRes.json()).data.request;
  }

  test('a new HMO request is discoverable via GET /hmo/requests (previously no list endpoint existed)', async () => {
    const request_ = await createPendingHmoRequest('M15List');
    const res = await apiContext.get(`${API}/hmo/requests`, { headers: { Authorization: `Bearer ${recToken}` } });
    expect(res.status()).toBe(200);
    const requests = (await res.json()).data.requests;
    expect(requests.some((r) => r.id === request_.id)).toBeTruthy();
  });

  test('the status filter only returns matching requests', async () => {
    const res = await apiContext.get(`${API}/hmo/requests`, {
      headers: { Authorization: `Bearer ${recToken}` },
      params: { status: 'Pending' },
    });
    const requests = (await res.json()).data.requests;
    for (const r of requests) {
      expect(r.status).toBe('Pending');
    }
  });

  test('approving a request at the request level updates its status', async () => {
    const request_ = await createPendingHmoRequest('M15Approve');
    const res = await apiContext.put(`${API}/hmo/request/${request_.id}/approve`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { approvalCode: 'LOA-E2E-REQ' },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.request.status).toBe('Approved');
  });

  test('a request-level approval does not automatically approve its linked test', async () => {
    const request_ = await createPendingHmoRequest('M15Granular');
    await apiContext.put(`${API}/hmo/request/${request_.id}/approve`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { approvalCode: 'LOA-E2E-GRANULAR' },
    });

    const detailRes = await apiContext.get(`${API}/hmo/request/${request_.id}`, { headers: { Authorization: `Bearer ${superToken}` } });
    const detail = (await detailRes.json()).data.request;
    expect(detail.tests[0].approval_status).toBe('Pending');
  });

  test('approving the specific linked test works independently', async () => {
    const request_ = await createPendingHmoRequest('M15TestApprove');
    const detailRes = await apiContext.get(`${API}/hmo/request/${request_.id}`, { headers: { Authorization: `Bearer ${superToken}` } });
    const hmoRequestTestId = (await detailRes.json()).data.request.tests[0].id;

    const res = await apiContext.put(`${API}/hmo/request-test/${hmoRequestTestId}`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { approvalStatus: 'Approved' },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.hmoRequestTest.approval_status).toBe('Approved');
  });

  test('a Client role cannot reach the HMO requests list', async () => {
    const { token } = await registerClientWithPatientAndVisit(apiContext, 'M15NoAccess', recToken);
    const res = await apiContext.get(`${API}/hmo/requests`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(403);
  });

  test('unauthenticated request to the HMO requests list is rejected', async () => {
    const res = await apiContext.get(`${API}/hmo/requests`);
    expect(res.status()).toBe(401);
  });
});

test.describe('Service Requests — browser flow', () => {
  test('the admin can review and approve a pending HMO request end to end', async ({ page }) => {
    const apiContext = await request.newContext();
    const recToken = await loginAs(apiContext, RECEPTIONIST);
    const { token: clientToken, visit } = await registerClientWithPatientAndVisit(apiContext, 'M15UI', recToken);
    const testsRes = await apiContext.get(`${API}/tests`);
    const ultrasoundTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Ultrasound');
    const vtRes = await apiContext.post(`${API}/tests/visit-tests`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      data: { patientVisitId: visit.id, testIds: [ultrasoundTest.id] },
    });
    const visitTest = (await vtRes.json()).data.visitTests[0];
    const providersRes = await apiContext.get(`${API}/hmo/providers`, { headers: { Authorization: `Bearer ${recToken}` } });
    const providerId = (await providersRes.json()).data.providers[0].id;
    await apiContext.post(`${API}/hmo/request`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { hmoProviderId: providerId, approvalCode: '', visitTestIds: [visitTest.id] },
    });
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', SUPERADMIN.email);
    await page.fill('input[type="password"]', SUPERADMIN.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Management Console')).toBeVisible({ timeout: 10000 });

    await page.getByText('Service Requests', { exact: true }).click();
    await expect(page.getByText('Service & HMO Requests')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Review' }).first().click();
    await expect(page.getByText('HMO Request Review')).toBeVisible({ timeout: 10000 });

    await page.getByPlaceholder('Enter approval code').fill('LOA-BROWSER-E2E');
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  });
});
