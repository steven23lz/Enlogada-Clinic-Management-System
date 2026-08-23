// @ts-check
import { test, expect } from 'playwright/test';

/**
 * The public catalogue folds a long category, and says so unmistakably. [1.38.0]
 *
 * Loading the clinic's real price list took Laboratory from 5 services to 22 while every other
 * category stayed at 4 or fewer, so one column of a three-column grid ran six times the height of
 * its neighbours and buried everything below it.
 *
 * Two properties are worth holding, and they pull against each other — which is the reason for a
 * spec rather than a glance:
 *
 *   the fold has to be OBVIOUS, because a visitor deciding whether this clinic does the test they
 *   need must be able to tell more exists without finding it by accident; and
 *
 *   it must only apply where it earns its place. Folding a one-item ECG card would add a click to
 *   reveal a single line, which is worse than the crowding it was meant to fix.
 */

async function openServices(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Services', exact: true }).first().click();
  await expect(page.getByText('Blood Typing').first()).toBeVisible({ timeout: 15000 });
}

test('a long category folds, and the control names what it will show', async ({ page }) => {
  await openServices(page);

  const rows = page.locator('#services-laboratory > div');
  const toggle = page.getByTestId('services-toggle-laboratory');

  await expect(toggle).toBeVisible();
  const collapsed = await rows.count();
  expect(collapsed, 'a folded category shows a bounded number of rows').toBeLessThan(await page
    .evaluate(() => Number(document.querySelector('[data-testid="services-toggle-laboratory"]')
      ?.textContent?.match(/\d+/)?.[0] || 0)));

  // The label carries the count rather than saying only that something exists — "See more" tells
  // a reader nothing about whether it is worth the click.
  await expect(toggle).toHaveText(/See all \d+ laboratory services/i);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-controls', 'services-laboratory');

  await toggle.click();
  expect(await rows.count(), 'expanding shows every service').toBeGreaterThan(collapsed);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveText(/show fewer/i);

  // And it folds back, so the control is a disclosure rather than a one-way reveal.
  await toggle.click();
  expect(await rows.count()).toBe(collapsed);
});

test('a short category is left alone', async ({ page }) => {
  await openServices(page);

  // ECG has one service. Anything that folds it has misunderstood the problem.
  await expect(page.getByTestId('services-toggle-ecg')).toHaveCount(0);
  await expect(page.getByText('12 Lead ECG').first()).toBeVisible();
});
