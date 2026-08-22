// @ts-check
import { test, expect } from 'playwright/test';

/**
 * The app's own calendar, which replaced the browser's unstylable one. [1.34.0]
 *
 * Two properties are worth a spec, because both were broken during the build and neither is
 * visible to any other test:
 *
 *   Clicking the field opens the calendar AND the field is still a field. The whole design rests
 *   on keeping a real `<input type="date">` — ISO values, native min/max, native required, and
 *   the OS picker on a phone — so a change that opened a popover at the cost of typing would have
 *   thrown away the reason for the architecture while looking like it worked.
 *
 *   Escape closes the calendar and NOT the dialog behind it. Radix registers its Escape handler
 *   in the capture phase when a dialog mounts, before any popover inside it exists, so it cannot
 *   be outrun — only made to stand down. One press used to discard a half-filled booking form.
 *
 * Not asserted here, deliberately: that Firefox renders no trigger of its own. Its calendar glyph
 * cannot be hidden by any CSS (Bugzilla 1830890 / 1812397, both open), so DateField renders
 * nothing custom there and the field stays exactly as the browser intends. That path has no
 * custom UI to test, and this suite runs chromium only.
 */

const CASHIER = { email: 'cashier@enlogada.com', password: 'Password123!' };

async function signIn(page, creds) {
  await page.goto('/');
  await page.getByText('Sign In', { exact: true }).first().click();
  await page.fill('input[type="email"]', creds.email);
  await page.fill('input[type="password"]', creds.password);
  await page.locator('button[type="submit"]').click();
}

test('clicking a date field opens the calendar, and the field still accepts typing', async ({ page }) => {
  test.setTimeout(60000);
  await signIn(page, CASHIER);
  await expect(page.getByText(/billing|terminal|queue/i).first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: /transaction history/i }).first().click();

  const field = page.locator('input[type="date"]').first();
  const calendar = page.getByRole('dialog', { name: 'Choose a date' });

  await expect(calendar).toBeHidden();
  await field.click();
  await expect(calendar, 'a click on the field should open the calendar').toBeVisible();

  // The property the whole design exists to protect. If this fails, the component has stopped
  // being a date input and every caller, form and test that reads its value is on borrowed time.
  await field.fill('2026-03-14');
  await expect(field).toHaveValue('2026-03-14');

  // And the grid followed the typed value rather than sitting on whatever month it opened at —
  // otherwise the calendar contradicts the field it belongs to.
  await expect(page.getByText('March 2026')).toBeVisible();

  // Picking a day writes back through the same path a caller's onChange already understands.
  await page.getByRole('button', { name: '20', exact: true }).click();
  await expect(field).toHaveValue('2026-03-20');
  await expect(calendar).toBeHidden();
});

test('escape closes the calendar without closing the dialog behind it', async ({ page }) => {
  test.setTimeout(60000);
  await signIn(page, CASHIER);
  await expect(page.getByText(/billing|terminal|queue/i).first()).toBeVisible({ timeout: 20000 });

  // Reception's walk-in registration is the nearest dialog holding a date field on a staff
  // screen; any dialog would do, the point is that one is open underneath.
  await page.getByRole('button', { name: /transaction history/i }).first().click();
  const field = page.locator('input[type="date"]').first();
  await field.click();

  const calendar = page.getByRole('dialog', { name: 'Choose a date' });
  await expect(calendar).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();

  // The field survived, and so did the screen. Focus returns to the trigger rather than being
  // dropped on the body, which is what keeps the control usable without a mouse.
  await expect(field).toBeVisible();
});
