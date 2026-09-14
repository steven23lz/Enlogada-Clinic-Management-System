// @ts-check
import { expect } from 'playwright/test';

/**
 * The patient portal's tabs and its booking button, named in one place. [1.80.0]
 *
 * Fifteen lines across nine specs clicked a portal tab or "Book Schedule" by its words, so the
 * redesign's renames — "Diagnostic Results" to "Results", "Book Schedule" to "Book a visit", and a
 * Home tab first — would have had to be found in nine files. A spec asks for a tab by what it IS;
 * this file says what it is called. src/components/portal/portalTabs.js holds the same words for
 * the app.
 */
export const PORTAL_TABS = {
  home: 'Home',
  appointments: 'Appointments',
  results: 'Results',
  payments: 'Payments',
  profile: 'Profile',
};

export const BOOK_BUTTON = 'Book a visit';

/** Open a portal tab by what it is: `openPortalTab(page, 'appointments')`. */
export async function openPortalTab(page, key) {
  const name = PORTAL_TABS[key];
  if (!name) throw new Error(`No portal tab "${key}". Known: ${Object.keys(PORTAL_TABS).join(', ')}`);
  await page.getByRole('tab', { name, exact: true }).click({ timeout: 20000 });
}

/**
 * Open the booking dialog, and hand it back once it is on screen.
 *
 * "Book a visit" is on Home and on Appointments. [1.81.0] From any other tab this goes Home first,
 * the way a patient would; the old hero put the button above every tab, and a spec that walked the
 * tabs first found no button on the last one.
 */
export async function openBooking(page) {
  const book = page.getByRole('button', { name: BOOK_BUTTON });
  if (!(await book.first().isVisible())) await openPortalTab(page, 'home');
  await book.first().click({ timeout: 20000 });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}
