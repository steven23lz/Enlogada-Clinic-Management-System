// @ts-check
import { test, expect, request } from 'playwright/test';

// Backend API-level authorization tests. These hit the Express API directly (no browser),
// exercising a real end-to-end workflow and regression-testing the five ownership/IDOR
// fixes made in the pre-implementation remediation pass (see database/migrations.md and
// backend/src/controllers/{resultController,visitController}.js).
//
// Test data is created dynamically per run (unique email per run) rather than relying on
// pre-existing seeded records, so this suite is deterministic and repeatable without manual
// DB setup beyond the standard migrateDb.js -> setupRbac.js -> seedUsers.js sequence.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const SUPERADMIN_EMAIL = 'admin@enlogada.com';
const SUPERADMIN_PASSWORD = 'Password123!';

function uniqueEmail(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}@enlogada-e2e.test`;
}

async function registerAndLoginClient(apiContext, prefix) {
  const email = uniqueEmail(prefix);
  const password = 'TestPass123!';

  const registerRes = await apiContext.post(`${API}/auth/register`, {
    data: {
      firstName: 'E2E',
      lastName: prefix,
      email,
      password,
      contactNumber: '09170000000',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  const loginRes = await apiContext.post(`${API}/auth/login`, {
    data: { email, password },
  });
  expect(loginRes.ok()).toBeTruthy();
  const loginBody = await loginRes.json();
  const token = loginBody.data.token;

  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      patientTypeId: 2, // "Private" — seeded 2nd in patient_types
      firstName: 'E2E',
      lastName: `${prefix}Patient`,
      birthdate: '1990-01-01',
      sex: 'Male',
      address: 'Test Address',
      contactNumber: '09170000000',
      emergencyContact: '09171111111',
    },
  });
  expect(patientRes.ok()).toBeTruthy();
  const patientBody = await patientRes.json();
  const patientId = patientBody.data.patient.id;

  return { token, patientId };
}

test.describe('API authorization — ownership and role boundaries', () => {
  let apiContext;
  let clientA;
  let clientB;
  let superAdminToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();

    clientA = await registerAndLoginClient(apiContext, 'ClientA');
    clientB = await registerAndLoginClient(apiContext, 'ClientB');

    const superAdminLogin = await apiContext.post(`${API}/auth/login`, {
      data: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
    });
    expect(superAdminLogin.ok()).toBeTruthy();
    superAdminToken = (await superAdminLogin.json()).data.token;
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('unauthenticated request to a protected endpoint is rejected', async () => {
    const res = await apiContext.get(`${API}/results/history/${clientA.patientId}`);
    expect(res.status()).toBe(401);
  });

  test('client can access their own patient result history', async () => {
    const res = await apiContext.get(`${API}/results/history/${clientA.patientId}`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
    });
    expect(res.status()).toBe(200);
  });

  test('client CANNOT access another client\'s patient result history (IDOR regression)', async () => {
    const res = await apiContext.get(`${API}/results/history/${clientB.patientId}`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test('client CANNOT access another client\'s visit history (IDOR regression)', async () => {
    const res = await apiContext.get(`${API}/visits/patient/${clientB.patientId}`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test('client cannot reach an admin-only endpoint', async () => {
    const res = await apiContext.get(`${API}/rbac/matrix`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test('SuperAdmin can reach the admin-only RBAC matrix endpoint', async () => {
    const res = await apiContext.get(`${API}/rbac/matrix`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.roles)).toBeTruthy();
    expect(Array.isArray(body.data.permissions)).toBeTruthy();
  });

  test('nonexistent patient id returns a clean error, not a crash', async () => {
    const res = await apiContext.get(`${API}/results/history/999999999`, {
      headers: { Authorization: `Bearer ${clientA.token}` },
    });
    // Client-owned-record check runs first and 404s on a patient id that doesn't exist.
    expect(res.status()).toBe(404);
  });
});
