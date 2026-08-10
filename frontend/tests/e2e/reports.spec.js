// @ts-check
import { test, expect, request } from 'playwright/test';

// Module 17 (Reporting) coverage. Module 12 built a minimal "Today's Snapshot" reporting entry
// point and explicitly deferred historical trends, date-range filtering, and the RBAC matrix
// report to this module. This module adds:
//
// 1. New backend surface: GET /reports/summary?startDate=&endDate= (reportRepository/
//    reportService/reportController/reportRoutes, Admin/SuperAdmin only) — revenue trend,
//    service volume by category, visit status breakdown, and payment method breakdown, all
//    aggregated server-side from existing tables (payments/visit_tests/patient_visits), no
//    schema change.
// 2. New frontend: ReportsOverview.jsx rewritten as a tabbed page — the pre-existing Today's
//    Snapshot tab is unchanged; new Date-Range Reports and RBAC Matrix tabs added.
// 3. A real gap found on inspection, not previously escalated: GET /rbac/matrix has always
//    authorized both SuperAdmin and Admin, but the only UI that ever called it
//    (SuperAdminManagement.jsx) is gated to SuperAdmin alone in the sidebar nav — Admin had
//    zero UI path to a capability the backend already grants them. Closed with a read-only
//    matrix view inside Reports (editing stays SuperAdmin-only under Super Admin Management).

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const SUPERADMIN = { email: 'admin@enlogada.com', password: 'Password123!' };
const ADMIN = { email: 'clinicadmin@enlogada.com', password: 'Password123!' };
const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const CLIENT = { email: 'client@enlogada.com', password: 'Password123!' };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

test.describe('Clinic report summary (API)', () => {
  let apiContext;
  let superToken;
  let adminToken;
  let recToken;
  let clientToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    superToken = await loginAs(apiContext, SUPERADMIN);
    adminToken = await loginAs(apiContext, ADMIN);
    recToken = await loginAs(apiContext, RECEPTIONIST);
    clientToken = await loginAs(apiContext, CLIENT);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('SuperAdmin can fetch the report summary with all 4 aggregates', async () => {
    const res = await apiContext.get(`${API}/reports/summary`, {
      headers: { Authorization: `Bearer ${superToken}` },
      params: { startDate: daysAgoStr(6), endDate: todayStr() },
    });
    expect(res.status()).toBe(200);
    const report = (await res.json()).data.report;
    expect(report).toHaveProperty('revenueTrend');
    expect(report).toHaveProperty('serviceVolume');
    expect(report).toHaveProperty('visitStatusBreakdown');
    expect(report).toHaveProperty('paymentMethodBreakdown');
  });

  test('Admin can also fetch the report summary', async () => {
    const res = await apiContext.get(`${API}/reports/summary`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: { startDate: daysAgoStr(6), endDate: todayStr() },
    });
    expect(res.status()).toBe(200);
  });

  test('a Receptionist is rejected with 403', async () => {
    const res = await apiContext.get(`${API}/reports/summary`, {
      headers: { Authorization: `Bearer ${recToken}` },
      params: { startDate: daysAgoStr(6), endDate: todayStr() },
    });
    expect(res.status()).toBe(403);
  });

  test('a Client is rejected with 403', async () => {
    const res = await apiContext.get(`${API}/reports/summary`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      params: { startDate: daysAgoStr(6), endDate: todayStr() },
    });
    expect(res.status()).toBe(403);
  });

  test('unauthenticated request is rejected with 401', async () => {
    const res = await apiContext.get(`${API}/reports/summary`, {
      params: { startDate: daysAgoStr(6), endDate: todayStr() },
    });
    expect(res.status()).toBe(401);
  });

  test('missing dates are rejected with 400, not a crash', async () => {
    const res = await apiContext.get(`${API}/reports/summary`, { headers: { Authorization: `Bearer ${superToken}` } });
    expect(res.status()).toBe(400);
  });

  test('startDate after endDate is rejected with 400', async () => {
    const res = await apiContext.get(`${API}/reports/summary`, {
      headers: { Authorization: `Bearer ${superToken}` },
      params: { startDate: todayStr(), endDate: daysAgoStr(6) },
    });
    expect(res.status()).toBe(400);
  });

  test('a malformed date string is rejected with 400, not a 500', async () => {
    const res = await apiContext.get(`${API}/reports/summary`, {
      headers: { Authorization: `Bearer ${superToken}` },
      params: { startDate: 'not-a-date', endDate: 'also-not-a-date' },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('Reports — browser flow', () => {
  test('SuperAdmin sees all 3 tabs with real data, RBAC Matrix is read-only', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', SUPERADMIN.email);
    await page.fill('input[type="password"]', SUPERADMIN.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Management Console')).toBeVisible({ timeout: 10000 });

    await page.getByText('Reports', { exact: true }).first().click();
    await expect(page.getByText("Today's Revenue")).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: 'Date-Range Reports' }).click();
    await expect(page.getByText('Revenue Trend')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Service Volume by Category')).toBeVisible();
    await expect(page.getByText('Visit Status Breakdown')).toBeVisible();
    await expect(page.getByText('Payment Method Breakdown')).toBeVisible();

    await page.getByRole('tab', { name: 'RBAC Matrix' }).click();
    await expect(page.getByText('Roles & Their Assigned Permissions')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Edit' })).not.toBeVisible();
  });

  test('changing the date range and applying re-fetches the report', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', SUPERADMIN.email);
    await page.fill('input[type="password"]', SUPERADMIN.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Management Console')).toBeVisible({ timeout: 10000 });

    await page.getByText('Reports', { exact: true }).first().click();
    await page.getByRole('tab', { name: 'Date-Range Reports' }).click();
    await expect(page.getByText('Revenue Trend')).toBeVisible({ timeout: 10000 });

    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.first().fill(daysAgoStr(1));
    await dateInputs.nth(1).fill(daysAgoStr(1));

    const summaryResponse = page.waitForResponse((res) => res.url().includes('/reports/summary') && res.status() === 200);
    await page.getByRole('button', { name: 'Apply' }).click();
    await summaryResponse;
  });

  test('Admin (not SuperAdmin) can now reach the RBAC matrix through Reports — closes the gap found on inspection', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', ADMIN.email);
    await page.fill('input[type="password"]', ADMIN.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Management Console')).toBeVisible({ timeout: 10000 });

    // Admin still has no "Super Admin" nav item at all — unchanged Module 13 behavior.
    await expect(page.getByRole('button', { name: 'Super Admin', exact: true })).not.toBeVisible();

    await page.getByText('Reports', { exact: true }).first().click();
    await page.getByRole('tab', { name: 'RBAC Matrix' }).click();
    await expect(page.getByText('Roles & Their Assigned Permissions')).toBeVisible({ timeout: 10000 });
  });
});
