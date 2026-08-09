// @ts-check
import { test, expect } from 'playwright/test';

// Uses the seeded demo account created by `backend/src/scripts/seedUsers.js`
// (password documented in CLAUDE.md — not a real/production credential).
const CLIENT_EMAIL = 'client@enlogada.com';
const CLIENT_PASSWORD = 'Password123!';

test.describe('Authentication flow', () => {
  test('unauthenticated visitor never sees an authenticated dashboard shell', async ({ page }) => {
    await page.goto('/');
    // No router in this app — an unauthenticated session must never render "Log Off"
    // (the authenticated-shell marker) no matter what state the page starts in.
    await expect(page.getByText('Log Off')).toHaveCount(0);
  });

  test('client can log in and reaches the client dashboard shell', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', CLIENT_EMAIL);
    await page.fill('input[type="password"]', CLIENT_PASSWORD);
    await page.locator('button[type="submit"]').click();

    // Reaching the authenticated shell proves App.jsx's role-based branch resolved
    // for the Client role and AuthContext.login() succeeded end-to-end.
    await expect(page.getByText('Log Off')).toBeVisible({ timeout: 10000 });
  });

  test('logout returns to the public (unauthenticated) view', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', CLIENT_EMAIL);
    await page.fill('input[type="password"]', CLIENT_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Log Off')).toBeVisible({ timeout: 10000 });

    await page.getByText('Log Off').click();
    await expect(page.getByText('Log Off')).toHaveCount(0);
    await expect(page.getByText('Sign In', { exact: true }).first()).toBeVisible();
  });
});
