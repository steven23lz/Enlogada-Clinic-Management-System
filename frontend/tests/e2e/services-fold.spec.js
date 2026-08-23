// @ts-check
import { test, expect } from 'playwright/test';

/**
 * The public catalogue stays usable now that Laboratory holds 20-odd services.
 *
 * This file used to assert a fold — the long category collapsed behind a "See all 22 laboratory
 * services" control. That fold is gone: the card grid it hung off was replaced by full-width
 * department sections with a search box, which answers the same question (how does a visitor find
 * one test among many) by letting them type it rather than by hiding the rest.
 *
 * So the assertions changed and the PROPERTY did not. What has to stay true is that a visitor
 * deciding whether this clinic does the test they need can find it, and that the preparation
 * instruction travels with it — this is the only screen somebody reads while still deciding, and
 * "nothing to eat for 8 hours" is what decides whether they book a morning slot.
 */

async function openServices(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Services', exact: true }).first().click();
  await expect(page.getByText('Blood Typing').first()).toBeVisible({ timeout: 15000 });
}

test('every department is listed, and a long one is not truncated', async ({ page }) => {
  await openServices(page);

  // Laboratory is the category that motivated all of this. Nothing may hide part of it.
  const lab = page.locator('section[aria-labelledby="cat-Laboratory"]');
  await expect(lab).toBeVisible();

  // Spread across the alphabet, so this fails if anything caps or paginates the list.
  for (const name of ['Blood Typing', 'Fasting Blood Sugar (FBS)', 'Urinalysis']) {
    await expect(lab.getByText(name, { exact: true }).first(), `${name} must be listed`).toBeVisible();
  }

  // And the small departments are still there — a layout tuned for the long one must not drop them.
  await expect(page.locator('section[aria-labelledby="cat-ECG"]')).toBeVisible();
});

test('search narrows the catalogue and can be cleared', async ({ page }) => {
  await openServices(page);

  const search = page.getByPlaceholder(/search a test/i);
  await search.fill('urinalysis');
  await page.waitForTimeout(300);

  await expect(page.getByText('Urinalysis', { exact: true }).first()).toBeVisible();
  // A department with no match should drop out entirely rather than render an empty shell.
  await expect(page.locator('section[aria-labelledby="cat-ECG"]')).toHaveCount(0);

  // A search that matches nothing must say so — an empty page and a broken page look identical.
  await search.fill('zzzznotathing');
  await page.waitForTimeout(300);
  await expect(page.getByText(/nothing matches that search/i)).toBeVisible();

  await search.fill('');
  await page.waitForTimeout(300);
  await expect(page.locator('section[aria-labelledby="cat-ECG"]')).toBeVisible();
});

test('preparation instructions travel with the test', async ({ page }) => {
  await openServices(page);

  // The reason this page matters before booking, asserted signed-out and with no account.
  await expect(page.getByText(/water for 8 hours/i).first()).toBeVisible();
});
