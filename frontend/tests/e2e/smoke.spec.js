// @ts-check
import { test, expect } from 'playwright/test';

test.describe('Smoke: app loads', () => {
  test('home page loads with clinic branding', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('ENLOGADA', { exact: false }).first()).toBeVisible();
  });

  test('login page is reachable and renders the login form', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('login form requires email and password before submitting', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Please fill in all fields.')).toBeVisible();
  });
});
