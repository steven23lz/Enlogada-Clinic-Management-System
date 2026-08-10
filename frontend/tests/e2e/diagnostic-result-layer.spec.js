// @ts-check
import { test, expect, request } from 'playwright/test';

// Module 16 (Diagnostic Result) coverage — the shared test_results data/logic layer itself
// (resultRepository.js/resultService.js/resultController.js), not the per-department UIs
// (Modules 9/10/11) or the client-facing viewer (Module 6), which already have their own spec
// files and were not touched here. Two real gaps found on inspection, both fixed in this
// module's own files:
//
// 1. A cross-category authorization gap escalated from Module 9: resultController.js/
//    resultService.js authorized any diagnostic staff role (Laboratory/Xray/Ultrasound Staff)
//    for ANY category's pending-list, status-update, upload, and release actions — there was no
//    check that e.g. a Laboratory Staff account calling these endpoints directly was only acting
//    on Laboratory-category visit_tests. The department scoping in DiagnosticDashboard.jsx was
//    purely client-side convenience with no server-side enforcement. Fixed with a
//    requestingUser-aware department check in resultService.js (SuperAdmin/Admin bypass, per
//    the existing RBAC convention).
// 2. A retry-safety gap found during inspection (not previously escalated): the
//    "Authorize & Release Result" action is two sequential API calls (upload, then release) for
//    one clinically-significant action. test_results.visit_test_id is UNIQUE and createResult
//    was a plain INSERT, so if the release call failed after the upload call already succeeded,
//    retrying the whole sequence would 500 on the unique-constraint violation, permanently
//    stuck. Fixed by making createResult an upsert (INSERT ... ON CONFLICT DO UPDATE).

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const LAB_STAFF = { email: 'lab@enlogada.com', password: 'Password123!' };
const XRAY_STAFF = { email: 'xray@enlogada.com', password: 'Password123!' };
const SUPERADMIN = { email: 'admin@enlogada.com', password: 'Password123!' };

function uniqueEmail(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}@enlogada-e2e.test`;
}

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

async function createVisitTestInCategory(apiContext, recToken, categoryName) {
  const email = uniqueEmail('M16');
  const password = 'TestPass123!';
  await apiContext.post(`${API}/auth/register`, { data: { firstName: 'M16', lastName: 'Client', email, password, contactNumber: '' } });
  const clientLogin = await apiContext.post(`${API}/auth/login`, { data: { email, password } });
  const clientToken = (await clientLogin.json()).data.token;

  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${clientToken}` },
    data: { patientTypeId: 2, firstName: 'M16', lastName: 'Patient', birthdate: '1990-01-01', sex: 'Male', address: '', contactNumber: '', emergencyContact: '' },
  });
  const patient = (await patientRes.json()).data.patient;

  const visitRes = await apiContext.post(`${API}/visits`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientId: patient.id, visitType: 'Walk in', notes: '' },
  });
  const visit = (await visitRes.json()).data.visit;

  const testsRes = await apiContext.get(`${API}/tests`);
  const targetTest = (await testsRes.json()).data.tests.find((t) => t.category_name === categoryName);

  const vtRes = await apiContext.post(`${API}/tests/visit-tests`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientVisitId: visit.id, testIds: [targetTest.id] },
  });
  const visitTest = (await vtRes.json()).data.visitTests[0];
  return visitTest.id;
}

test.describe('Cross-category authorization (Module 16 fix)', () => {
  let apiContext;
  let recToken;
  let labToken;
  let xrayToken;
  let superToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginAs(apiContext, RECEPTIONIST);
    labToken = await loginAs(apiContext, LAB_STAFF);
    xrayToken = await loginAs(apiContext, XRAY_STAFF);
    superToken = await loginAs(apiContext, SUPERADMIN);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('Laboratory Staff cannot list another department\'s pending worklist', async () => {
    const res = await apiContext.get(`${API}/results/pending/Xray`, { headers: { Authorization: `Bearer ${labToken}` } });
    expect(res.status()).toBe(403);
  });

  test('Laboratory Staff cannot advance the status of an Xray visit_test', async () => {
    const visitTestId = await createVisitTestInCategory(apiContext, recToken, 'Xray');
    const res = await apiContext.patch(`${API}/results/test-status/${visitTestId}`, {
      headers: { Authorization: `Bearer ${labToken}` },
      data: { status: 'Processing' },
    });
    expect(res.status()).toBe(403);
  });

  test('Laboratory Staff cannot upload a result for an Xray visit_test', async () => {
    const visitTestId = await createVisitTestInCategory(apiContext, recToken, 'Xray');
    const res = await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: { Authorization: `Bearer ${labToken}` },
      data: { findings: 'cross-department attempt', remarks: '', fileUrl: null },
    });
    expect(res.status()).toBe(403);
  });

  test('Laboratory Staff cannot release a result for an Xray visit_test', async () => {
    const visitTestId = await createVisitTestInCategory(apiContext, recToken, 'Xray');
    // Have the rightful department upload findings first, so the only variable under test is
    // the release-authorization check, not "no result exists yet".
    await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: { Authorization: `Bearer ${xrayToken}` },
      data: { findings: 'legit findings', remarks: '', fileUrl: null },
    });
    const res = await apiContext.post(`${API}/results/${visitTestId}/release`, { headers: { Authorization: `Bearer ${labToken}` } });
    expect(res.status()).toBe(403);
  });

  test('the rightful department can still act on its own category end to end', async () => {
    const visitTestId = await createVisitTestInCategory(apiContext, recToken, 'Xray');
    const statusRes = await apiContext.patch(`${API}/results/test-status/${visitTestId}`, {
      headers: { Authorization: `Bearer ${xrayToken}` },
      data: { status: 'Processing' },
    });
    expect(statusRes.status()).toBe(200);

    const uploadRes = await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: { Authorization: `Bearer ${xrayToken}` },
      data: { findings: 'own department findings', remarks: '', fileUrl: null },
    });
    expect(uploadRes.status()).toBe(201);

    const releaseRes = await apiContext.post(`${API}/results/${visitTestId}/release`, { headers: { Authorization: `Bearer ${xrayToken}` } });
    expect(releaseRes.status()).toBe(200);
  });

  test('SuperAdmin bypasses the department check regardless of category', async () => {
    const visitTestId = await createVisitTestInCategory(apiContext, recToken, 'Xray');
    const res = await apiContext.patch(`${API}/results/test-status/${visitTestId}`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { status: 'Processing' },
    });
    expect(res.status()).toBe(200);
  });

  test('acting on a nonexistent visit_test returns 404, not a 500 or a false-pass', async () => {
    const res = await apiContext.patch(`${API}/results/test-status/999999999`, {
      headers: { Authorization: `Bearer ${xrayToken}` },
      data: { status: 'Processing' },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('Upload+release retry-safety (upsert fix)', () => {
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

  test('retrying the upload call for the same visit_test overwrites instead of 500ing on the unique constraint', async () => {
    const visitTestId = await createVisitTestInCategory(apiContext, recToken, 'Xray');

    const first = await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: { Authorization: `Bearer ${xrayToken}` },
      data: { findings: 'first attempt', remarks: '', fileUrl: null },
    });
    expect(first.status()).toBe(201);

    const retry = await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: { Authorization: `Bearer ${xrayToken}` },
      data: { findings: 'retried attempt', remarks: '', fileUrl: null },
    });
    expect(retry.status()).toBe(201);
    expect((await retry.json()).data.result.findings).toBe('retried attempt');

    const release = await apiContext.post(`${API}/results/${visitTestId}/release`, { headers: { Authorization: `Bearer ${xrayToken}` } });
    expect(release.status()).toBe(200);
  });
});
