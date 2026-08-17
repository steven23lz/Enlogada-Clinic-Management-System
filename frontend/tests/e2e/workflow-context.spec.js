// @ts-check
import { test, expect } from 'playwright/test';

// Information each role needs *on the screen where they act*, rather than one screen away.
//
// These came out of a business-process walkthrough — following a visit from the front desk to the
// modality to the patient — rather than from a bug report. Each one was a case where the data
// already existed, the API already returned it, and the screen that needed it did not show it.
// That is the failure mode a page-by-page smoke test cannot see: every screen loads, nothing
// errors, and the work is still harder than it should be.

const PASSWORD = 'Password123!';

async function signIn(page, email) {
  await page.goto('/');
  await page.getByText('Sign In', { exact: true }).first().click();
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.locator('button[type="submit"]').click();
}

test('the diagnostic worklist shows age and sex, which decide the reference range', async ({ page }) => {
  // Not cosmetic. Diagnostic reference ranges are banded by age and by sex — a haemoglobin that
  // is normal for a 40-year-old man is anaemia in a child — so a technician recording findings
  // has to know which band applies. The query returned birthdate and sex all along; the worklist
  // rendered neither, and the tech had to open a second screen to find out.
  await signIn(page, 'lab@enlogada.com');
  await expect(page.getByRole('heading', { name: /laboratory operations worklist/i }))
    .toBeVisible({ timeout: 15000 });

  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 15000 });

  // "PT-12 · 31y · Male" under the patient's name.
  const first = rows.first();
  await expect(first).toContainText(/\d+y/);
  await expect(first).toContainText(/Male|Female/);
});

test('the diagnostic worklist names the referring physician when there is one', async ({ page }) => {
  // The report goes back to this doctor, and a technician querying an odd result needs to know
  // who to call. [1.23.0] recorded it and put it on the report and the HMO review; the worklist
  // — where the work happens — was missed.
  await signIn(page, 'lab@enlogada.com');
  await expect(page.getByRole('heading', { name: /laboratory operations worklist/i }))
    .toBeVisible({ timeout: 15000 });

  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
  // The seeded worklist tickets carry a referrer, so at least one row shows it.
  await expect(page.getByText(/Ref: Dr\./).first()).toBeVisible({ timeout: 10000 });
});

test('an upcoming booking tells the patient what to do beforehand', async ({ page }) => {
  // [1.24.0] put preparation in the booking wizard and the confirmation email, then left it off
  // the one screen a patient opens the day before to check the time. A patient who booked three
  // weeks ago and wants to re-read the instruction had nowhere to look.
  await signIn(page, 'client@enlogada.com');
  await expect(page.getByText(/welcome/i).first()).toBeVisible({ timeout: 15000 });

  await page.getByRole('tab', { name: 'Appointments' }).click();

  const card = page.locator('[data-testid="appointment-card"]').first();
  await expect(card).toBeVisible({ timeout: 15000 });

  await expect(page.getByText('Before this appointment').first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/8 hours|bladder|pregnant|loose top/i).first()).toBeVisible();
});
