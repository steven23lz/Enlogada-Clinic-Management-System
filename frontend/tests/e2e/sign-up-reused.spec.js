// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInOnPhone } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';
import { fixturePerson, fixtureEmail } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';

/**
 * What a patient gave at sign-up is used, and what they agree to can be read. [1.173.0]
 *
 * Steven, signing up on his phone: the sign-up form asked for a name and a contact number, and the
 * first patient profile then asked for both again. And the Terms and the Privacy policy, opened from
 * the sign-up form, showed a heading on the first screen and nothing under it: their sections waited
 * for a scroll animation.
 */

const PASSWORD = 'Password123!';
test.use({ viewport: { width: 390, height: 844 } });

test("an account's first profile starts from its sign-up details, and keeps what the patient changes", async ({ page }) => {
  const ctx = await request.newContext();
  const person = fixturePerson();
  const email = fixtureEmail(person);
  await registerClient(ctx, { ...person, email, password: PASSWORD });
  await ctx.dispose();

  await signInOnPhone(page, email, PASSWORD);
  await openPortalTab(page, 'profile');
  await page.getByRole('button', { name: 'Add a profile' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('profile-prefilled')).toBeVisible();
  await expect(dialog.locator('#add-profile-first-name')).toHaveValue(person.firstName);
  await expect(dialog.locator('#add-profile-last-name')).toHaveValue(person.lastName);

  // Someone else: the name is theirs to change, and the form keeps what they type.
  await dialog.locator('#add-profile-first-name').fill('Lourdes');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add a profile' }).click();
  await expect(page.getByRole('dialog').locator('#add-profile-first-name')).toHaveValue('Lourdes');
});

for (const [which, first] of [['terms', 'Appointments & Changes'], ['privacy', 'What We Collect']]) {
  test(`the ${which} page shows its text at once, without scrolling for it`, async ({ page }) => {
    await page.goto(`/?legal=${which}`);
    const section = page.getByRole('heading', { name: first, level: 2 });
    await expect(section).toBeVisible({ timeout: 15000 });
    const sections = page.locator('section[aria-labelledby]');
    expect(await sections.count()).toBeGreaterThanOrEqual(5);
    const opacities = await sections.evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity));
    expect(opacities.every((o) => o === '1'), 'no section waits for a scroll to appear').toBe(true);
  });
}
