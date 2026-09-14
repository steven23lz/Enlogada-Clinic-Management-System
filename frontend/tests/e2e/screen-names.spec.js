// @ts-check
import { test, expect } from 'playwright/test';
import { signIn, openScreen } from './helpers/auth.js';

/**
 * A screen is called what its sidebar calls it. [1.79.0]
 *
 * The staff-side audit found screens with two or three names. The sidebar said "Laboratory
 * Worklist" over a heading reading "Laboratory Operations Worklist"; "Service Requests" opened
 * "Service & HMO Requests"; the top bar said "Appointments Oversight" and "Clinic Reports" while the
 * sidebar said "Appointments" and "Reports". Someone told to open a screen by name looked for words
 * the screen never showed.
 *
 * The breadcrumb now reads the sidebar's own label (config/navigation.js), and every heading is
 * the same words. These hold both, for every role's screens.
 */

const SCREENS = [
  {
    who: 'an Admin', email: 'clinicadmin@enlogada.com',
    names: ['Staff Accounts', 'Service Requests', 'Services Catalog', 'Cashier Monitoring', 'Appointments', 'Patient Records', 'Clinic Schedule', 'Reports', 'Activity Log'],
  },
  { who: 'SuperAdmin', email: 'admin@enlogada.com', names: ['Super Admin'] },
  { who: 'the laboratory', email: 'lab@enlogada.com', names: ['Laboratory Worklist', 'Laboratory History'] },
  { who: 'the cashier', email: 'cashier@enlogada.com', names: ['Billing Queue', 'Online Payments', 'Transaction History'] },
  { who: 'the front desk', email: 'receptionist@enlogada.com', names: ['Desk', 'Visit History'] },
];

for (const { who, email, names } of SCREENS) {
  test(`${who}: every screen's heading and breadcrumb are its sidebar name`, async ({ page }) => {
    test.setTimeout(120000);
    await signIn(page, email);
    for (const name of names) {
      await openScreen(page, name);
      await expect(page.getByRole('heading', { level: 1, name, exact: true }), `the ${name} heading`)
        .toBeVisible({ timeout: 20000 });
      await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(name);
    }
  });
}

test('My Account has a heading of its own', async ({ page }) => {
  // It was the one staff screen with no <h1>, so a screen reader started on "Profile" at level three.
  await signIn(page, 'receptionist@enlogada.com');
  await page.getByRole('button', { name: 'My Account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Account', exact: true })).toBeVisible({ timeout: 20000 });
});
