// @ts-check
import { test, expect, request } from 'playwright/test';

// Module 5 (Profile) coverage — a client's own account settings: contact info,
// password management, and read-only role/permissions. Distinct from Module 4
// (Patient Management), which covers `patients` records, not the `users` account.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

function uniqueEmail(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}@enlogada-e2e.test`;
}

async function registerClient(apiContext, prefix) {
  const email = uniqueEmail(prefix);
  const password = 'TestPass123!';
  await apiContext.post(`${API}/auth/register`, {
    data: { firstName: 'E2E', lastName: prefix, email, password, contactNumber: '09170000000' },
  });
  const loginRes = await apiContext.post(`${API}/auth/login`, { data: { email, password } });
  const token = (await loginRes.json()).data.token;
  return { email, password, token };
}

test.describe('Account profile — update contact info (API)', () => {
  let apiContext;
  let client;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    client = await registerClient(apiContext, 'ProfA');
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('client can update their own account contact info', async () => {
    const res = await apiContext.put(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${client.token}` },
      data: { firstName: 'Updated', lastName: 'Name', contactNumber: '09991112222' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.user.firstName).toBe('Updated');
    expect(body.data.user.contactNumber).toBe('09991112222');
  });

  test('updating with missing first/last name is rejected with 400', async () => {
    const res = await apiContext.put(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${client.token}` },
      data: { contactNumber: '09991112222' },
    });
    expect(res.status()).toBe(400);
  });

  test('unauthenticated update request is rejected', async () => {
    const res = await apiContext.put(`${API}/auth/me`, {
      data: { firstName: 'X', lastName: 'Y' },
    });
    expect(res.status()).toBe(401);
  });

  test('a userId in the request body is ignored — the JWT alone determines whose account is updated', async () => {
    const otherClient = await registerClient(apiContext, 'ProfVictim');
    const meBefore = await (await apiContext.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${otherClient.token}` } })).json();

    const res = await apiContext.put(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${client.token}` },
      data: { userId: meBefore.data.user.id, firstName: 'StillMine', lastName: 'StillMine' },
    });
    expect(res.status()).toBe(200);

    const meAfter = await (await apiContext.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${otherClient.token}` } })).json();
    expect(meAfter.data.user.firstName).toBe('E2E');
  });
});

test.describe('Account profile — change password (API)', () => {
  let apiContext;
  let client;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    client = await registerClient(apiContext, 'ProfPw');
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('wrong current password is rejected with 400', async () => {
    const res = await apiContext.put(`${API}/auth/change-password`, {
      headers: { Authorization: `Bearer ${client.token}` },
      data: { currentPassword: 'WrongPassword1!', newPassword: 'NewValidPass1!' },
    });
    expect(res.status()).toBe(400);
  });

  test('new password shorter than 8 characters is rejected with 400', async () => {
    const res = await apiContext.put(`${API}/auth/change-password`, {
      headers: { Authorization: `Bearer ${client.token}` },
      data: { currentPassword: client.password, newPassword: 'short' },
    });
    expect(res.status()).toBe(400);
  });

  test('unauthenticated change-password request is rejected', async () => {
    const res = await apiContext.put(`${API}/auth/change-password`, {
      data: { currentPassword: client.password, newPassword: 'NewValidPass1!' },
    });
    expect(res.status()).toBe(401);
  });

  test('correct current password changes the password and the new one logs in', async () => {
    const res = await apiContext.put(`${API}/auth/change-password`, {
      headers: { Authorization: `Bearer ${client.token}` },
      data: { currentPassword: client.password, newPassword: 'NewValidPass1!' },
    });
    expect(res.status()).toBe(200);

    const oldLoginRes = await apiContext.post(`${API}/auth/login`, { data: { email: client.email, password: client.password } });
    expect(oldLoginRes.status()).toBe(401);

    const newLoginRes = await apiContext.post(`${API}/auth/login`, { data: { email: client.email, password: 'NewValidPass1!' } });
    expect(newLoginRes.status()).toBe(200);
  });
});

test.describe('Account profile — browser flow', () => {
  test('editing account info and changing password via the UI works end to end', async ({ page }) => {
    const apiContext = await request.newContext();
    const client = await registerClient(apiContext, 'ProfUI');
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', client.email);
    await page.fill('input[type="password"]', client.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Enlogada Diagnostic Patient Portal')).toBeVisible({ timeout: 10000 });

    // Navigate to My Account via the Navbar
    await page.getByRole('button', { name: 'My Account' }).click();
    await expect(page.getByRole('heading', { name: 'My Account' })).toBeVisible();

    // Role card shows Client
    await expect(page.getByText('Client', { exact: true })).toBeVisible();

    // Update contact info
    const phoneInput = page.locator('input[placeholder="09171234567"]');
    await phoneInput.fill('');
    await phoneInput.fill('09995554444');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText('Your account details have been updated.')).toBeVisible({ timeout: 10000 });

    // Change password with mismatched confirmation is rejected client-side
    const pwInputs = page.locator('input[type="password"]');
    await pwInputs.nth(0).fill(client.password);
    await pwInputs.nth(1).fill('AnotherValid1!');
    await pwInputs.nth(2).fill('DoesNotMatch1!');
    await page.getByRole('button', { name: 'Change Password' }).click();
    await expect(page.getByText('New password and confirmation do not match.')).toBeVisible();

    // Now with matching confirmation
    await pwInputs.nth(2).fill('');
    await pwInputs.nth(2).fill('AnotherValid1!');
    await page.getByRole('button', { name: 'Change Password' }).click();
    await expect(page.getByText('Your password has been changed.')).toBeVisible({ timeout: 10000 });

    // Navigate back to the dashboard
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByText('Enlogada Diagnostic Patient Portal')).toBeVisible();
  });
});
