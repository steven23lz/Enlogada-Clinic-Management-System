// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInOnPhone, signInTo } from './helpers/auth.js';
import { openPortalTab, openBooking, PORTAL_TABS } from './helpers/portal.js';
import { nthWorkingDay } from './helpers/dates.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { patientTypeId } from './helpers/patients.js';
import { API } from './helpers/payments.js';

/**
 * The browser's Back button. [1.152.0]
 *
 * The app keeps its screen in React state, so Back on a phone left the site from anywhere and took a
 * half-filled booking with it. Steven's call. lib/backStack.js makes each screen and each open dialog
 * a history entry.
 */

const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const selectedTab = (page) => page.getByRole('tab', { selected: true }).first();

test.describe('The Back button [1.152.0]', () => {
  let ctx;
  test.beforeAll(async () => { ctx = await request.newContext(); });
  test.afterAll(async () => { await ctx?.dispose(); });

  async function patient() {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const created = await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, token, 'Self Pay'),
        firstName: person.firstName, lastName: person.lastName, birthdate: '1990-03-14', sex: 'Female',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, emergencyContact: '',
      },
    });
    expect(created.status()).toBe(201);
    return { email, token };
  }

  test('moves between portal tabs, and Forward comes back', async ({ page }) => {
    const { email } = await patient();
    await signIn(page, email, PASSWORD);
    await openPortalTab(page, 'appointments');
    await openPortalTab(page, 'results');
    await expect(selectedTab(page)).toHaveText(PORTAL_TABS.results);

    await page.goBack();
    await expect(selectedTab(page)).toHaveText(PORTAL_TABS.appointments);
    await page.goBack();
    await expect(selectedTab(page)).toHaveText(PORTAL_TABS.home);
    await page.goForward();
    await expect(selectedTab(page)).toHaveText(PORTAL_TABS.appointments);
  });

  test('a reload stays on the tab, and Back still works after it', async ({ page }) => {
    const { email } = await patient();
    await signIn(page, email, PASSWORD);
    await openPortalTab(page, 'appointments');
    await page.reload();
    await expect(selectedTab(page)).toHaveText(PORTAL_TABS.appointments, { timeout: 20000 });
    await page.goBack();
    await expect(selectedTab(page)).toHaveText(PORTAL_TABS.home);
  });

  test('closes a half-filled booking and keeps it, staying on the screen', async ({ page }) => {
    const { email } = await patient();
    await signIn(page, email, PASSWORD);
    await openPortalTab(page, 'appointments');
    const date = nthWorkingDay(140);

    let dialog = await openBooking(page);
    await dialog.locator('#slotpicker-label').fill(date);
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(selectedTab(page), 'the dialog first, not the tab behind it').toHaveText(PORTAL_TABS.appointments);

    dialog = await openBooking(page);
    await expect(dialog.locator('#slotpicker-label'), 'what they typed is still there').toHaveValue(date);
  });

  test('a dialog closed by its own button leaves no dead press behind', async ({ page }) => {
    const { email } = await patient();
    await signIn(page, email, PASSWORD);
    await openPortalTab(page, 'appointments');
    await openBooking(page);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goBack();
    await expect(selectedTab(page), 'one press, one screen').toHaveText(PORTAL_TABS.home);
  });

  test('opening one dialog right after closing another keeps the two straight', async ({ page }) => {
    const { email } = await patient();
    await signIn(page, email, PASSWORD);
    await openPortalTab(page, 'appointments');
    await openBooking(page);
    // In one go, before the browser has finished stepping back from the first, as a dialog that opens
    // another does.
    await page.evaluate(async () => {
      const named = (root, name) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
      named(document.querySelector('[role="dialog"]'), 'Close').click();
      // Long enough for React to close it (a microtask), too short for the browser's step back.
      await Promise.resolve();
      await Promise.resolve();
      named(document, 'Book a visit').click();
    });
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(selectedTab(page), 'Back closed the second dialog, and nothing else').toHaveText(PORTAL_TABS.appointments);
    await page.goBack();
    await expect(selectedTab(page), 'and the entries beneath it are in order').toHaveText(PORTAL_TABS.home);
  });

  test('on a phone, too', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const { email } = await patient();
    await signInOnPhone(page, email, PASSWORD);
    await openPortalTab(page, 'payments');
    await openPortalTab(page, 'home');
    await openBooking(page);
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(selectedTab(page)).toHaveText(PORTAL_TABS.home);
    await page.goBack();
    await expect(selectedTab(page)).toHaveText(PORTAL_TABS.payments);
  });

  test('moves between public pages', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Services', exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/services|tests/i);
    await page.goBack();
    await expect(page.getByRole('button', { name: 'Services', exact: true }).first()).toBeVisible();
    await expect(page.getByText(/your trusted/i).first()).toBeVisible();
  });

  test('after signing out, Back never shows the portal again', async ({ page }) => {
    const { email } = await patient();
    await signIn(page, email, PASSWORD);
    await openPortalTab(page, 'appointments');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByTestId('account-menu').getByRole('menuitem', { name: /log ?out|sign ?out/i })
      .or(page.getByTestId('account-menu').getByRole('button', { name: /log ?out|sign ?out/i })).first().click();
    await expect(page.getByRole('tab', { name: PORTAL_TABS.appointments, exact: true })).toHaveCount(0, { timeout: 15000 });

    await page.goBack();
    await page.waitForTimeout(500);
    await expect(page.getByRole('tab', { name: PORTAL_TABS.appointments, exact: true })).toHaveCount(0);
    await page.goBack();
    await page.waitForTimeout(500);
    await expect(page.getByRole('tab', { name: PORTAL_TABS.appointments, exact: true })).toHaveCount(0);
  });

  test('moves between staff screens, and closes the Desk\'s registration sheet', async ({ page }) => {
    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    await expect(page.getByRole('heading', { name: 'Desk', level: 1 })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Register Walk-In' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Desk', level: 1 }), 'the sheet first').toBeVisible();

    await page.goBack();
    await expect(page.getByTestId('today-needs')).toBeVisible({ timeout: 20000 });
  });
});
