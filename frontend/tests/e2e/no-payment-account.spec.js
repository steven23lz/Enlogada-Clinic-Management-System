// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo } from './helpers/auth.js';
import { bookableTestId } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { patientTypeId } from './helpers/patients.js';
import { API } from './helpers/payments.js';
import { runScript } from './helpers/backendScript.js';

/**
 * No payment account published: no online booking, and the clinic is told. [1.153.0]
 *
 * Steven: "of course no account payment published then of course no booking right? it should prompt in
 * the admin side or super admin side". Payment first has nothing to stand on otherwise: the patient has
 * nowhere to send money, and with no time to pay, an unpaid booking held its slot until its day passed.
 *
 * The published accounts are never really hidden here: one is the clinic's real GCash. The server's half
 * runs in a transaction that is rolled back (e2eNoPaymentAccount.js), and the screens get an empty list.
 */

const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

/** The screens see a clinic with nothing published. */
const noAccounts = (page) => page.route('**/api/payment-methods', (route) => (
  route.request().method() === 'GET'
    ? route.fulfill({ json: { status: 'success', data: { methods: [] } } })
    : route.continue()
));

test.describe('No payment account published [1.153.0]', () => {
  let ctx;
  test.beforeAll(async () => { ctx = await request.newContext(); });
  test.afterAll(async () => { await ctx?.dispose(); });

  async function patient() {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token, user } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const profile = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, token, 'Self Pay'),
        firstName: person.firstName, lastName: person.lastName, birthdate: '1990-03-14', sex: 'Female',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, emergencyContact: '',
      },
    })).json()).data.patient;
    return { email, token, user, profile };
  }

  test('the server refuses the booking, and nothing is left behind', async () => {
    const before = (await (await ctx.get(`${API}/payment-methods`)).json()).data.methods;
    const owner = await patient();
    const output = runScript('e2eNoPaymentAccount.js', [
      `--user=${owner.user.id}`, `--patient=${owner.profile.id}`, `--test=${await bookableTestId(ctx)}`,
      `--date=${nthWorkingDay(130)}`, '--time=09:00',
    ], 'no payment account');
    const outcome = JSON.parse(output.split('\n').find((line) => line.startsWith('OUTCOME ')).slice('OUTCOME '.length));
    test.skip(outcome.status === 'skipped', 'The payment gateway is on, which keeps online booking open.');

    expect(outcome.status).toBe(409);
    expect(outcome.message).toMatch(/no payment account/i);
    const bookings = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(owner.token) })).json()).data.bookings;
    expect(bookings).toHaveLength(0);
    const after = (await (await ctx.get(`${API}/payment-methods`)).json()).data.methods;
    expect(after.map((m) => m.id), 'the accounts are as they were').toEqual(before.map((m) => m.id));
  });

  test('the patient is told before filling anything in', async ({ page }) => {
    const owner = await patient();
    await noAccounts(page);
    await signIn(page, owner.email, PASSWORD);
    await page.getByRole('button', { name: 'Book a visit' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('booking-closed')).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Online booking is closed for now' })).toBeVisible();
    await expect(dialog.locator('#slotpicker-label'), 'no form to fill in').toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /submit schedule request/i })).toHaveCount(0);
  });

  test('with an account published the form is there as usual', async ({ page }) => {
    const owner = await patient();
    await signIn(page, owner.email, PASSWORD);
    await page.getByRole('button', { name: 'Book a visit' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('#slotpicker-label')).toBeVisible();
    await expect(dialog.getByTestId('booking-closed')).toHaveCount(0);
  });

  test("the SuperAdmin's Today says so, and its button opens where to publish one", async ({ page }) => {
    await noAccounts(page);
    await signIn(page, 'admin@enlogada.com');
    const need = page.locator('[data-testid="today-need"][data-need="payment-account"]');
    await expect(need).toBeVisible({ timeout: 20000 });
    await expect(need).toContainText('Patients cannot book online');
    await need.getByRole('button', { name: 'Publish an account' }).click();
    await expect(page.getByRole('tab', { name: 'Payment Methods' })).toHaveAttribute('aria-selected', 'true', { timeout: 20000 });
  });

  test("an Admin's Today says so too, and who can publish one", async ({ page }) => {
    await noAccounts(page);
    await signIn(page, 'clinicadmin@enlogada.com');
    const need = page.locator('[data-testid="today-need"][data-need="payment-account"]');
    await expect(need).toBeVisible({ timeout: 20000 });
    await expect(need).toContainText(/only the superadmin can publish/i);
    await expect(need.getByRole('button'), 'an Admin cannot open that screen').toHaveCount(0);
  });

  test('the front desk is not told what it cannot fix', async ({ page }) => {
    await noAccounts(page);
    await signInTo(page, 'receptionist@enlogada.com', 'Today');
    await expect(page.getByTestId('today-needs')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-testid="today-need"][data-need="payment-account"]')).toHaveCount(0);
  });

  test('with an account published, no Today says anything', async ({ page }) => {
    await signIn(page, 'admin@enlogada.com');
    await expect(page.getByTestId('today-needs')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-testid="today-need"][data-need="payment-account"]')).toHaveCount(0);
  });
});
