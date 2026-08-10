// @ts-check
import { test, expect, request } from 'playwright/test';

// UI/UX Phase 2 (Findability) coverage: server-driven pagination + N+1 fix on the active-visits
// queue, the new Visit History endpoint/view, Cashier's billing-queue filter/sort, and
// Diagnostic's worklist status filter + pagination.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const CASHIER = { email: 'cashier@enlogada.com', password: 'Password123!' };
const LAB = { email: 'lab@enlogada.com', password: 'Password123!' };
const CLIENT = { email: 'client@enlogada.com', password: 'Password123!' };

async function loginToken(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

test.describe('GET /visits/active — pagination + filters (API)', () => {
  let apiContext;
  let recToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginToken(apiContext, RECEPTIONIST);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('a paginated request returns pagination metadata and a page-sized slice', async () => {
    const res = await apiContext.get(`${API}/visits/active`, {
      headers: { Authorization: `Bearer ${recToken}` },
      params: { page: 1, limit: 5 },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.visits.length).toBeLessThanOrEqual(5);
    expect(typeof body.data.total).toBe('number');
    expect(typeof body.data.totalPages).toBe('number');
    expect(typeof body.data.pendingCount).toBe('number');
    expect(body.data.page).toBe(1);
  });

  test('an unpaginated request (no page/limit) still returns the full filtered list, unchanged from before Phase 2', async () => {
    const res = await apiContext.get(`${API}/visits/active`, {
      headers: { Authorization: `Bearer ${recToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.visits)).toBeTruthy();
    expect(body.data.page).toBeUndefined();
  });

  test('unauthenticated request is rejected', async () => {
    const res = await apiContext.get(`${API}/visits/active`);
    expect(res.status()).toBe(401);
  });
});

test.describe('GET /visits/history — date-ranged visit history (API)', () => {
  let apiContext;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('Receptionist can fetch visit history for a date range', async () => {
    const recToken = await loginToken(apiContext, RECEPTIONIST);
    const today = new Date().toISOString().slice(0, 10);
    const res = await apiContext.get(`${API}/visits/history`, {
      headers: { Authorization: `Bearer ${recToken}` },
      params: { startDate: today, endDate: today },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.visits)).toBeTruthy();
  });

  test('Cashier (not in the allowed role list) is forbidden', async () => {
    const cashierToken = await loginToken(apiContext, CASHIER);
    const res = await apiContext.get(`${API}/visits/history`, {
      headers: { Authorization: `Bearer ${cashierToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('unauthenticated request is rejected', async () => {
    const res = await apiContext.get(`${API}/visits/history`);
    expect(res.status()).toBe(401);
  });
});

test.describe('Receptionist — Visit History browser flow', () => {
  test('Visit History nav destination loads a date-ranged table', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', RECEPTIONIST.email);
    await page.fill('input[type="password"]', RECEPTIONIST.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Active Queue Visits')).toBeVisible({ timeout: 10000 });

    await page.getByText('Visit History', { exact: true }).click();
    await expect(page.getByText('Look up past patient visits')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();
  });

  test('the active queue table shows a Prev/Next pagination footer', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', RECEPTIONIST.email);
    await page.fill('input[type="password"]', RECEPTIONIST.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Active Queue Visits')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Page \d+ of \d+/)).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Cashier — billing queue filter/sort + Transaction History date range', () => {
  test('billing queue shows a sort toggle and wait-time badges', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', CASHIER.email);
    await page.fill('input[type="password"]', CASHIER.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Pending Billing Queue')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Oldest First')).toBeVisible();
  });

  test('Transaction History shows a date-range picker', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', CASHIER.email);
    await page.fill('input[type="password"]', CASHIER.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Pending Billing Queue')).toBeVisible({ timeout: 10000 });

    await page.getByText('Transaction History', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[type="date"]').first()).toBeVisible();
  });
});

test.describe('Diagnostic — worklist status filter', () => {
  test('status filter chips are present and switching to Pending does not error', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', LAB.email);
    await page.fill('input[type="password"]', LAB.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Active Modality')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Pending', exact: true }).click();
    await expect(page.getByText(/Worklist Queue/)).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Client role is excluded from Reception/Cashier findability endpoints', () => {
  test('a Client cannot list the active-visits queue', async () => {
    const apiContext = await request.newContext();
    const clientToken = await loginToken(apiContext, CLIENT);
    const res = await apiContext.get(`${API}/visits/active`, {
      headers: { Authorization: `Bearer ${clientToken}` },
    });
    expect(res.status()).toBe(403);
    await apiContext.dispose();
  });
});
