// @ts-check
import { test, expect } from 'playwright/test';

// Module 2 (Home) coverage — public landing page, unauthenticated.

test.describe('Home page (Module 2)', () => {
  test('renders hero, headline, and both primary CTAs', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Your Trusted Diagnostic Partner/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Book Now' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View Services' })).toBeVisible();
  });

  test('renders all three service highlight cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Licensed Diagnostics')).toBeVisible();
    await expect(page.getByText('Fast & Accurate Results')).toBeVisible();
    await expect(page.getByText('HMO & Private Support')).toBeVisible();
  });

  test('"Book Now" navigates an anonymous visitor to Login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Book Now' }).click();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('"Access Portal" (bottom CTA) also navigates an anonymous visitor to Login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Access Portal' }).click();
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('"View Services" navigates to the Services page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'View Services' }).click();
    // ServicesPage fetches the live catalog — confirm we left Home, not that catalog content loaded
    // (catalog content/loading states belong to a different module).
    await expect(page.getByRole('heading', { name: /Your Trusted Diagnostic Partner/i })).toHaveCount(0);
  });

  test('header "Home" link is highlighted as the active tab', async ({ page }) => {
    await page.goto('/');
    const homeLink = page.getByRole('button', { name: 'Home', exact: true });
    await expect(homeLink).toHaveClass(/text-\[#769046\]/);
  });

  test('footer renders contact info and quick links', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('enlogadaclinic2011@gmail.com')).toBeVisible();
    await expect(page.getByText('Bugo, Cagayan de Oro, Philippines 9000')).toBeVisible();
  });
});
