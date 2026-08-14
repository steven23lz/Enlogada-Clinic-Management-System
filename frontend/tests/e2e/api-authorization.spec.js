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

// Separation of duties between Admin (clinic manager) and SuperAdmin.
//
// Admin reads everything and writes nothing inside a department. Both halves are asserted: a
// permission removed without checking the read still works is how oversight silently breaks, and
// these are the routes whose records carry the actor's name (a released result names its
// clinician, a receipt names its cashier). See backend/src/routes/resultRoutes.js for the
// reasoning and frontend/src/config/navigation.js for the matching sidebar boundary.
test.describe('Admin vs SuperAdmin — separation of duties', () => {
  let apiContext;
  let adminToken;
  let superAdminToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    const login = async (email) => {
      const res = await apiContext.post(`${API}/auth/login`, { data: { email, password: 'Password123!' } });
      expect(res.ok()).toBeTruthy();
      return (await res.json()).data.token;
    };
    adminToken = await login('clinicadmin@enlogada.com');
    superAdminToken = await login(SUPERADMIN_EMAIL);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('Admin cannot capture a payment, but SuperAdmin retains break-glass access', async () => {
    const body = { patientVisitId: 1, paymentMethod: 'Cash', amount: 1 };
    const asAdmin = await apiContext.post(`${API}/payments`, {
      headers: { Authorization: `Bearer ${adminToken}` }, data: body,
    });
    expect(asAdmin.status()).toBe(403);

    // Any non-403 proves the role gate let SuperAdmin through; the visit id is a placeholder, so
    // a validation error here is a pass, not a failure.
    const asSuper = await apiContext.post(`${API}/payments`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }, data: body,
    });
    expect(asSuper.status()).not.toBe(403);
  });

  test('Admin cannot author or release a clinical result', async () => {
    const upload = await apiContext.post(`${API}/results/1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { findings: 'should not be accepted', remarks: '', fileUrl: null },
    });
    expect(upload.status()).toBe(403);

    const release = await apiContext.post(`${API}/results/1/release`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(release.status()).toBe(403);
  });

  test('Admin keeps the oversight reads that make the restriction workable', async () => {
    const pending = await apiContext.get(`${API}/results/pending/Laboratory`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(pending.status()).toBe(200);

    const transactions = await apiContext.get(`${API}/payments/transactions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(transactions.status()).toBe(200);
  });

  test('editing role permissions stays SuperAdmin-only', async () => {
    const res = await apiContext.put(`${API}/rbac/roles/1/permissions`, {
      headers: { Authorization: `Bearer ${adminToken}` }, data: { permissionIds: [] },
    });
    expect(res.status()).toBe(403);
  });
});

// Combined-role access. A user holding two operational roles must reach BOTH consoles: the
// sidebar and the router are driven by one registry now, but this is the case that regressed
// before (the sidebar offered Billing while the router kept returning the Front Desk console),
// so it is worth holding onto. Requires the multirole@enlogada.com account — see
// TEST_ACCOUNTS.md; the test skips rather than fails if it has not been created.
test.describe('Combined-role access', () => {
  test('a Receptionist+Cashier reaches both the Front Desk and Billing consoles', async ({ page }) => {
    const apiContext = await request.newContext();
    const login = await apiContext.post(`${API}/auth/login`, {
      data: { email: 'multirole@enlogada.com', password: 'Password123!' },
    });
    const exists = login.ok();
    await apiContext.dispose();
    test.skip(!exists, 'multirole@enlogada.com not seeded on this database');

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', 'multirole@enlogada.com');
    await page.fill('input[type="password"]', 'Password123!');
    await page.locator('button[type="submit"]').click();

    // Both departments offered in the sidebar...
    await expect(page.getByText('Walk-In Registration', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Billing Queue', { exact: true })).toBeVisible();

    // ...and the advertised one actually opens, rather than leaving them on the first console
    // their role list happened to match.
    await page.getByText('Billing Queue', { exact: true }).first().click();
    await expect(page.getByText(/Cashier POS|Billing Terminal/i).first()).toBeVisible({ timeout: 10000 });
  });
});
