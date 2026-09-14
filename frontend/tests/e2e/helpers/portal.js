// @ts-check
import { expect } from 'playwright/test';

/**
 * The patient portal's tabs and its booking button, named in one place. [1.80.0]
 *
 * Fifteen lines across nine specs clicked a portal tab or "Book Schedule" by its words. The
 * portal's redesign renames three of them — "Diagnostic Results" becomes "Results", "Book Schedule"
 * becomes "Book a visit", and a Home tab arrives first — and a rename that has to be found in nine
 * files is one that gets missed in the ninth. A spec asks for a tab by what it IS; this file says
 * what it is called.
 */
export const PORTAL_TABS = {
  results: 'Diagnostic Results',
  appointments: 'Appointments',
  payments: 'Payments',
  profile: 'Profile',
};

export const BOOK_BUTTON = 'Book Schedule';

/** Open a portal tab by what it is: `openPortalTab(page, 'appointments')`. */
export async function openPortalTab(page, key) {
  const name = PORTAL_TABS[key];
  if (!name) throw new Error(`No portal tab "${key}". Known: ${Object.keys(PORTAL_TABS).join(', ')}`);
  await page.getByRole('tab', { name, exact: true }).click({ timeout: 20000 });
}

/** Open the booking dialog, and hand it back once it is on screen. */
export async function openBooking(page) {
  await page.getByRole('button', { name: BOOK_BUTTON }).first().click({ timeout: 20000 });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}
