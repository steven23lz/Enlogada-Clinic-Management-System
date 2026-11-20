// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInOnPhone } from './helpers/auth.js';
import { openBooking, openPortalTab, attachDoctorRequest } from './helpers/portal.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { removeUnpaid } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';

/**
 * The patient's dialogs at a phone's width, in dark mode, as Steven's phone shows them. [1.173.0]
 *
 * mobile-patient.spec.js checks that no PAGE scrolls sideways. A dialog clips what does not fit
 * instead of scrolling, so a button cut in half inside one passed it: "Keep current time" lost its
 * first letter on the reschedule dialog, the booking confirmation's reference code ran over the
 * queue ticket beside it, the pay panel inherited the confirmation's centring, and the times on
 * the slot grid were as wide as their own text, in a box that scrolled inside the dialog's scroll.
 */

const API = (process.env.E2E_API_URL || 'http://localhost:5000') + '/api';
const PASSWORD = 'Password123!';
test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });

/** Every visible element in the open dialog that reaches past its edges. */
const spillsOut = (page) => page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const d = dialog.getBoundingClientRect();
  return [...dialog.querySelectorAll('button, a, input, label, span, p, li')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > d.right + 1 || r.left < d.left - 1); })
    .map((e) => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 40));
});

test('booking, confirming, moving and adding a profile fit a phone, nothing cut or overlapping', async ({ page }) => {
  test.setTimeout(120000);
  const ctx = await request.newContext();
  const person = fixturePerson();
  const email = fixtureEmail(person);
  const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
  const auth = { Authorization: `Bearer ${token}` };
  await ctx.post(`${API}/patients`, {
    headers: auth,
    data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1990-01-01', sex: 'Male', contactNumber: FIXTURE_CONTACT },
  });

  try {
    await signInOnPhone(page, email, PASSWORD);
    const dialog = await openBooking(page);
    await dialog.locator('#slotpicker-label').fill(nthWorkingDay(252));
    const slots = dialog.locator('[data-testid^="slot-"]');
    await expect(slots.first()).toBeVisible({ timeout: 15000 });

    // One width for every time, whatever its text, and the grid scrolls with the dialog.
    const widths = await slots.evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().width)))]);
    expect(widths, '8:00 AM as wide as 10:30 AM').toHaveLength(1);
    const grid = await slots.first().evaluate((e) => getComputedStyle(e.parentElement).overflowY);
    expect(grid, 'no scroll box inside the dialog').toBe('visible');

    await dialog.locator('[data-testid="slot-08:30"]').click();
    await dialog.getByRole('checkbox').first().check();
    await attachDoctorRequest(dialog);
    await dialog.getByRole('button', { name: /submit schedule request/i }).click();
    const reference = dialog.getByText(/APT-[A-Z0-9]+/).first();
    await expect(reference).toBeVisible({ timeout: 20000 });

    // The confirmation: the pay panel reads left to right, and the reference code has room.
    const align = await dialog.getByTestId('final-tests-check').evaluate((e) => getComputedStyle(e).textAlign);
    expect(align, 'the test list is not centred').not.toBe('center');
    const ticket = dialog.getByText('Given at the desk when you check in');
    const [a, b] = [await reference.boundingBox(), await ticket.boundingBox()];
    const copy = await dialog.getByRole('button', { name: /copy/i }).first().boundingBox();
    const overlaps = (x, y) => x && y && x.x < y.x + y.width && y.x < x.x + x.width && x.y < y.y + y.height && y.y < x.y + x.height;
    expect(overlaps(a, b) || overlaps(copy, b), 'the reference code and its copy button stay off the queue ticket').toBeFalsy();
    expect(await spillsOut(page), 'nothing on the confirmation reaches past the screen').toEqual([]);
    await page.keyboard.press('Escape');

    // Moving it: both buttons whole.
    await openPortalTab(page, 'appointments');
    await page.getByRole('button', { name: 'Reschedule' }).first().click();
    const move = page.getByRole('dialog');
    await expect(move.getByText('Reschedule Appointment')).toBeVisible();
    await move.getByRole('button', { name: 'Keep current time' }).scrollIntoViewIfNeeded();
    expect(await spillsOut(page), 'nothing on the reschedule dialog is cut off').toEqual([]);
    await move.getByRole('button', { name: 'Keep current time' }).click();

    // Adding a profile.
    await openPortalTab(page, 'profile');
    await page.getByRole('button', { name: 'Add a profile' }).click();
    await expect(page.getByRole('dialog').getByText('Add a patient profile')).toBeVisible();
    expect(await spillsOut(page), 'nothing on the profile form is cut off').toEqual([]);
  } finally {
    const bookings = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth })).json()).data.bookings || [];
    for (const bk of bookings) await removeUnpaid(bk.id || bk.appointment_id);
    await ctx.dispose();
  }
});
