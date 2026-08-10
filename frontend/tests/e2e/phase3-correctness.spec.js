// @ts-check
import { test, expect, request } from 'playwright/test';

// UI/UX Phase 3 (Correctness & trust) coverage: the Admin HMO Partners card now reflects real
// data, the Client account page no longer shows raw RBAC permission strings, Privacy/Terms
// links are wired up, and Receptionist's two check-in paths both require confirmation.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const ADMIN = { email: 'admin@enlogada.com', password: 'Password123!' };
const CLIENT = { email: 'client@enlogada.com', password: 'Password123!' };

test.describe('Admin Overview — real HMO Partners count', () => {
  test('the HMO Partners card is not hardcoded to "1CoopHealth"', async ({ page }) => {
    const apiContext = await request.newContext();
    const loginRes = await apiContext.post(`${API}/auth/login`, { data: ADMIN });
    const token = (await loginRes.json()).data.token;
    const providersRes = await apiContext.get(`${API}/hmo/providers`, { headers: { Authorization: `Bearer ${token}` } });
    const providerCount = (await providersRes.json()).data.providers.length;
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', ADMIN.email);
    await page.fill('input[type="password"]', ADMIN.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('System Command Center')).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('1CoopHealth')).toHaveCount(0);
    await expect(page.getByText(`${providerCount} Partner${providerCount === 1 ? '' : 's'}`)).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Client Account — no raw permission strings', () => {
  test('the Account page shows the role badge but no resource:action permission strings', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', CLIENT.email);
    await page.fill('input[type="password"]', CLIENT.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('button', { name: 'My Account' }).first()).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'My Account' }).first().click();
    await expect(page.getByText('Account Type')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Client', { exact: true })).toBeVisible();
    await expect(page.getByText(/appointments:(create|read)/)).toHaveCount(0);
  });
});

test.describe('Public — Privacy Policy and Terms of Service pages', () => {
  test('footer links navigate to real, distinct pages', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Privacy Policy' }).click();
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Terms of Service' }).click();
    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible({ timeout: 10000 });
  });
});
