// @ts-check
import { test, expect } from 'playwright/test';

// The patient journey on a phone. [1.26.0]
//
// Staff sit at desks; patients do not. Online booking, the QR pass presented at the counter and
// the released report are all things somebody does on a 390px screen, and none of it had ever
// been checked at that width — every existing browser spec runs at the default desktop viewport.
//
// The two failure modes worth guarding are the ones that make an app unusable rather than ugly:
// a page that scrolls sideways, and a control that cannot be reached at all.

const PASSWORD = 'Password123!';
const PHONE = { width: 390, height: 844 }; // iPhone 14 / 15, the common floor

/** Sign in the way somebody on a phone has to: through the hamburger. */
async function signInOnPhone(page, email) {
  await page.goto('/');
  // The desktop nav is display:none at this width, so its "Sign In" is present but unclickable —
  // scoping to the mobile panel is the difference between testing the phone and testing nothing.
  await page.getByRole('button', { name: 'Open menu' }).click();
  const menu = page.locator('header div.md\\:hidden').last();
  await menu.getByRole('button', { name: 'Sign In' }).click();

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.locator('button[type="submit"]').click();
}

test.use({ viewport: PHONE });

test('a patient can sign in and reach their bookings on a phone', async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await signInOnPhone(page, 'client@enlogada.com');
  await expect(page.getByText(/welcome/i).first()).toBeVisible({ timeout: 20000 });

  // Every tab has to be reachable, not merely present. A tab strip that overflows its container
  // silently drops the last items off the right edge.
  for (const tab of ['Diagnostic Results', 'Appointments', 'Payments', 'Profile']) {
    const trigger = page.getByRole('tab', { name: tab });
    await expect(trigger, `${tab} tab should exist`).toHaveCount(1);
    await trigger.click();
    await page.waitForTimeout(600);
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('no screen in the patient journey scrolls sideways on a phone', async ({ page }) => {
  test.setTimeout(90000);
  await signInOnPhone(page, 'client@enlogada.com');
  await expect(page.getByText(/welcome/i).first()).toBeVisible({ timeout: 20000 });

  const overflowOf = () => page.evaluate(() => {
    const d = document.documentElement;
    // scrollbar-gutter makes clientWidth exceed scrollWidth, which reads as negative overflow.
    // Only a positive difference is a page the user has to drag sideways.
    return Math.max(0, d.scrollWidth - d.clientWidth);
  });

  for (const tab of ['Diagnostic Results', 'Appointments', 'Payments', 'Profile']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(700);
    expect(await overflowOf(), `${tab} overflows horizontally`).toBe(0);
  }

  // And the booking dialog, which is the densest thing a patient opens.
  await page.getByRole('button', { name: 'Book Schedule' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(600);
  expect(await overflowOf(), 'the booking dialog overflows horizontally').toBe(0);
});
