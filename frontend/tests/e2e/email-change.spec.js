// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';
import { registerClient, setAuthCode, TEST_CODE } from './helpers/accounts.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { patientTypeId } from './helpers/patients.js';

/**
 * A patient changes their sign-in email. [1.147.0]
 *
 * Steven: what if a patient uses another email? Any provider always worked; what could not happen
 * was moving to a new one, so a patient on a new address needed a second account. Now: the current
 * password, then a code sent to the NEW address, and nothing changes until it is entered. A staff
 * address stays with Staff Accounts, and an address another account has is refused.
 */

const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;
const PASSWORD = 'TestPass123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

/** A throwaway patient whose own profile carries the account's address. */
async function patient(ctx) {
  const person = fixturePerson();
  const email = fixtureEmail(person);
  const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
  const profile = (await (await ctx.post(`${API}/patients`, {
    headers: auth(token),
    data: {
      patientTypeId: await patientTypeId(ctx, API, token, 'Self Pay'),
      firstName: person.firstName, lastName: person.lastName, birthdate: '1988-07-02', sex: 'Male',
      address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, emergencyContact: '', email,
    },
  })).json()).data.patient;
  return { person, email, token, profile };
}

const login = (ctx, email, password = PASSWORD) => ctx.post(`${API}/auth/login`, { data: { email, password } });

test.describe('Changing the sign-in email', () => {
  let ctx;
  test.beforeAll(async () => { ctx = await request.newContext(); });
  test.afterAll(async () => { await ctx?.dispose(); });

  test('a code to the new address, then the account and its own record use it', async () => {
    const { person, email, token, profile } = await patient(ctx);
    const newEmail = fixtureEmail(person);
    const start = (data) => ctx.post(`${API}/auth/email-change`, { headers: auth(token), data });

    const wrong = await start({ newEmail, password: 'not-my-password' });
    expect(wrong.status(), 'the password is asked for, and a wrong one is not a sign-out').toBe(400);
    expect((await start({ newEmail: email, password: PASSWORD })).status(), 'the same address').toBe(400);
    const taken = await start({ newEmail: 'client@enlogada.com', password: PASSWORD });
    expect(taken.status(), "another account's address").toBe(409);

    const started = await start({ newEmail, password: PASSWORD });
    expect(started.status(), await started.text()).toBe(200);
    const { ticket } = (await started.json()).data;
    // Nothing has changed yet.
    expect((await login(ctx, email)).status()).toBe(200);

    setAuthCode(newEmail, 'email_change');
    const confirm = (code) => ctx.post(`${API}/auth/email-change/confirm`, { headers: auth(token), data: { ticket, code } });
    expect((await confirm('000000')).status(), 'a wrong code').toBe(400);
    const done = await confirm(TEST_CODE);
    expect(done.status(), await done.text()).toBe(200);
    expect((await done.json()).data.user.email).toBe(newEmail);

    expect((await login(ctx, newEmail)).status(), 'signs in with the new address').toBe(200);
    expect((await login(ctx, email)).status(), 'and no longer with the old one').not.toBe(200);

    const mine = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(token) })).json()).data.patients;
    expect(mine.find((p) => p.id === profile.id).email, 'their own record follows the new address').toBe(newEmail);
  });

  test("a staff member's address is changed on Staff Accounts, not here", async () => {
    const staff = (await (await login(ctx, 'receptionist@enlogada.com', 'Password123!')).json()).data.token;
    const res = await ctx.post(`${API}/auth/email-change`, {
      headers: auth(staff), data: { newEmail: 'desk.new@enlogada-e2e.test', password: 'Password123!' },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).message).toMatch(/Staff Accounts/);
  });

  test('My Account changes it in two steps, password then code', async ({ page }) => {
    const { person, email } = await patient(ctx);
    const newEmail = fixtureEmail(person);

    await signIn(page, email, PASSWORD);
    await openPortalTab(page, 'home');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByTestId('account-menu').getByRole('button', { name: 'My Account' }).click();
    await page.getByRole('button', { name: 'Change email' }).click();

    const dialog = page.getByTestId('change-email');
    await dialog.locator('#change-email-new').fill(newEmail);
    await dialog.locator('#change-email-password').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Send code' }).click();
    await expect(dialog).toContainText(`We sent a 6-digit code to ${newEmail}`, { timeout: 15000 });

    setAuthCode(newEmail, 'email_change');
    await dialog.locator('#change-email-code').fill(TEST_CODE);
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
    await expect(page.getByLabel('Sign-in email').or(page.locator('[aria-labelledby="account-email-label"]'))).toContainText(newEmail);
  });
});
