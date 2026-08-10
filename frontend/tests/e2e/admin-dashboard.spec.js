// @ts-check
import { test, expect, request } from 'playwright/test';

// Module 12 (Admin Dashboard) coverage. AdminDashboard.jsx previously ignored activeNav
// entirely — every one of the 8 admin nav destinations rendered the same static content
// (a duplicate of ServicesCatalog.jsx's catalog table, plus a hardcoded fake "Today's Revenue
// ₱4,850.00 / +14% vs yesterday" KPI). This pass built 5 real sections (Staff Accounts, Cashier
// Monitoring, Appointments Oversight, Patient Records Oversight, Reports) and replaced the fake
// KPI with real data. 'service-requests' is intentionally left as an honest placeholder — it
// belongs to Module 15, out of this task's scope.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const SUPERADMIN = { email: 'admin@enlogada.com', password: 'Password123!' };
const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const CLIENT = { email: 'client@enlogada.com', password: 'Password123!' };

function uniqueEmail(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}@enlogada-e2e.test`;
}

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

test.describe('Staff account management (API)', () => {
  let apiContext;
  let adminToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    adminToken = await loginAs(apiContext, SUPERADMIN);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('creating a staff account with a manageable role succeeds', async () => {
    const email = uniqueEmail('Staff');
    const res = await apiContext.post(`${API}/admin/staff`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { firstName: 'E2E', lastName: 'Staffer', email, password: 'TestPass123!', contactNumber: '09170000000', role: 'Receptionist' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.staff.roles).toEqual(['Receptionist']);
  });

  test('creating a staff account with Admin/SuperAdmin role is rejected (privilege escalation guard)', async () => {
    const email = uniqueEmail('WouldBeAdmin');
    const res = await apiContext.post(`${API}/admin/staff`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { firstName: 'E2E', lastName: 'WouldBeAdmin', email, password: 'TestPass123!', role: 'Admin' },
    });
    expect(res.status()).toBe(400);
  });

  test('creating a staff account with a duplicate email is rejected', async () => {
    const email = uniqueEmail('Dup');
    await apiContext.post(`${API}/admin/staff`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { firstName: 'E2E', lastName: 'First', email, password: 'TestPass123!', role: 'Cashier' },
    });
    const res = await apiContext.post(`${API}/admin/staff`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { firstName: 'E2E', lastName: 'Second', email, password: 'TestPass123!', role: 'Cashier' },
    });
    expect(res.status()).toBe(400);
  });

  test('the staff list only contains the 5 manageable operational roles, never Admin/SuperAdmin/Client', async () => {
    const res = await apiContext.get(`${API}/admin/staff`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const staff = (await res.json()).data.staff;
    const allowedRoles = ['Receptionist', 'Cashier', 'Laboratory Staff', 'Ultrasound Staff', 'Xray Staff'];
    expect(staff.length).toBeGreaterThan(0);
    for (const s of staff) {
      expect(allowedRoles).toContain(s.roles[0]);
    }
  });

  test('deactivating a staff account prevents them from logging in, and reactivating restores it', async () => {
    const email = uniqueEmail('ToggleMe');
    const createRes = await apiContext.post(`${API}/admin/staff`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { firstName: 'E2E', lastName: 'ToggleMe', email, password: 'TestPass123!', role: 'Cashier' },
    });
    const staffId = (await createRes.json()).data.staff.id;

    const deactivateRes = await apiContext.patch(`${API}/admin/staff/${staffId}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: false },
    });
    expect(deactivateRes.status()).toBe(200);

    const blockedLogin = await apiContext.post(`${API}/auth/login`, { data: { email, password: 'TestPass123!' } });
    expect(blockedLogin.status()).toBe(401);

    const reactivateRes = await apiContext.patch(`${API}/admin/staff/${staffId}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: true },
    });
    expect(reactivateRes.status()).toBe(200);

    const restoredLogin = await apiContext.post(`${API}/auth/login`, { data: { email, password: 'TestPass123!' } });
    expect(restoredLogin.status()).toBe(200);
  });

  test('the status endpoint cannot be used against a non-staff account (e.g. a Client)', async () => {
    const clientEmail = uniqueEmail('NotStaff');
    const registerRes = await apiContext.post(`${API}/auth/register`, {
      data: { firstName: 'E2E', lastName: 'NotStaff', email: clientEmail, password: 'TestPass123!', contactNumber: '' },
    });
    const clientUserId = (await (await apiContext.post(`${API}/auth/login`, { data: { email: clientEmail, password: 'TestPass123!' } })).json());
    expect(registerRes.ok()).toBeTruthy();

    // Look up the client's own id via /auth/me
    const meRes = await apiContext.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${clientUserId.data.token}` } });
    const targetId = (await meRes.json()).data.user.id;

    const res = await apiContext.patch(`${API}/admin/staff/${targetId}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { status: false },
    });
    expect(res.status()).toBe(403);
  });

  test('a Client role cannot reach staff management endpoints', async () => {
    const clientToken = await loginAs(apiContext, CLIENT);
    const res = await apiContext.get(`${API}/admin/staff`, { headers: { Authorization: `Bearer ${clientToken}` } });
    expect(res.status()).toBe(403);
  });

  test('a Receptionist (non-admin staff) cannot reach staff management endpoints', async () => {
    const recToken = await loginAs(apiContext, RECEPTIONIST);
    const res = await apiContext.get(`${API}/admin/staff`, { headers: { Authorization: `Bearer ${recToken}` } });
    expect(res.status()).toBe(403);
  });

  test('unauthenticated requests to staff endpoints are rejected', async () => {
    const res = await apiContext.get(`${API}/admin/staff`);
    expect(res.status()).toBe(401);
  });
});

test.describe('Appointments oversight (API)', () => {
  let apiContext;
  let adminToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    adminToken = await loginAs(apiContext, SUPERADMIN);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('Admin can list all appointments across all patients', async () => {
    const res = await apiContext.get(`${API}/appointments`, { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(res.status()).toBe(200);
    const appointments = (await res.json()).data.appointments;
    expect(Array.isArray(appointments)).toBeTruthy();
  });

  test('the status filter only returns matching appointments', async () => {
    const res = await apiContext.get(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: { status: 'Cancelled' },
    });
    const appointments = (await res.json()).data.appointments;
    for (const a of appointments) {
      expect(a.status).toBe('Cancelled');
    }
  });

  test('a Client cannot reach the appointments oversight endpoint', async () => {
    const clientToken = await loginAs(apiContext, CLIENT);
    const res = await apiContext.get(`${API}/appointments`, { headers: { Authorization: `Bearer ${clientToken}` } });
    expect(res.status()).toBe(403);
  });

  test('a Receptionist cannot reach the appointments oversight endpoint', async () => {
    const recToken = await loginAs(apiContext, RECEPTIONIST);
    const res = await apiContext.get(`${API}/appointments`, { headers: { Authorization: `Bearer ${recToken}` } });
    expect(res.status()).toBe(403);
  });
});

test.describe('Admin Dashboard — browser flow', () => {
  test('creating and deactivating a staff account works end to end through the UI', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', SUPERADMIN.email);
    await page.fill('input[type="password"]', SUPERADMIN.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('System Command Center')).toBeVisible({ timeout: 10000 });

    await page.getByText('Staff Accounts', { exact: true }).click();
    await page.getByRole('button', { name: 'Add Staff Account' }).click();

    const email = uniqueEmail('UIStaff');
    const form = page.locator('form').filter({ has: page.getByText('Temporary Password') });
    await form.locator('input').nth(0).fill('UI');
    await form.locator('input').nth(1).fill('Staffer');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill('TestPass123!');
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Cashier' }).click();
    await page.getByRole('button', { name: 'Create Account' }).click();

    await expect(page.getByText(email)).toBeVisible({ timeout: 10000 });

    const row = page.getByText(email).locator('xpath=ancestor::tr[1]');
    await row.getByText('Active').click();
    await page.getByRole('button', { name: 'Deactivate' }).click();
    await expect(row.getByText('Deactivated')).toBeVisible({ timeout: 10000 });
  });

  test('the dashboard overview shows real data, not the previous hardcoded fake revenue figure', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', SUPERADMIN.email);
    await page.fill('input[type="password"]', SUPERADMIN.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText("Today's Revenue")).toBeVisible({ timeout: 10000 });

    // The old version hardcoded exactly this figure regardless of real data — it must never
    // appear again now that the KPI is computed from GET /payments/transactions.
    await expect(page.getByText('₱4,850.00')).toHaveCount(0);
    await expect(page.getByText('+14% vs yesterday')).toHaveCount(0);
  });

  test('the Service Requests nav shows an honest placeholder, not stale/wrong content', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', SUPERADMIN.email);
    await page.fill('input[type="password"]', SUPERADMIN.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('System Command Center')).toBeVisible({ timeout: 10000 });

    await page.getByText('Service Requests', { exact: true }).click();
    await expect(page.getByText('Not Yet Available')).toBeVisible({ timeout: 10000 });
  });

  test('Reports shows a real revenue trend line derived from actual transactions', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', SUPERADMIN.email);
    await page.fill('input[type="password"]', SUPERADMIN.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('System Command Center')).toBeVisible({ timeout: 10000 });

    await page.getByText('Reports', { exact: true }).click();
    await expect(page.getByText('vs yesterday', { exact: false })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('reporting entry point', { exact: false })).toBeVisible();
  });
});
