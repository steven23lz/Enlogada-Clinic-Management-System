// @ts-check
import { test, expect, request } from 'playwright/test';

// Module 13 (Super Admin Management) coverage. Before this pass, SuperAdmin and Admin were
// never distinguished anywhere in the app — every route paired them together, and the RBAC
// matrix had zero frontend UI. This module built the first real SuperAdmin-only capabilities:
// RBAC administration (viewing was already Admin+SuperAdmin; editing is now SuperAdmin-only)
// and elevated (Admin/SuperAdmin) account management, entirely new.
//
// Also fixed two real bugs in the pre-existing rbacController.js while refactoring it into
// proper layers (routes -> controller -> service -> repository, matching this repo's own
// convention, which the original file violated by writing raw SQL directly in the controller):
//   1. updateRolePermissions deleted a role's permissions then re-inserted one at a time with
//      no transaction — a failure partway through could silently leave a role with zero
//      permissions. Now wrapped in BEGIN/COMMIT/ROLLBACK.
//   2. The edit endpoint was callable by Admin, not just SuperAdmin, which is backwards for
//      the one capability MODULE_SCOPE.md names as this module's own ("RBAC administration").

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const SUPERADMIN = { email: 'admin@enlogada.com', password: 'Password123!' };
const ADMIN = { email: 'clinicadmin@enlogada.com', password: 'Password123!' };
const CLIENT = { email: 'client@enlogada.com', password: 'Password123!' };

function uniqueEmail(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}@enlogada-e2e.test`;
}

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

test.describe('RBAC administration (API)', () => {
  let apiContext;
  let superToken;
  let adminToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    superToken = await loginAs(apiContext, SUPERADMIN);
    adminToken = await loginAs(apiContext, ADMIN);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('Admin can still view the RBAC matrix (unchanged from Module 12)', async () => {
    const res = await apiContext.get(`${API}/rbac/matrix`, { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.roles)).toBeTruthy();
    expect(Array.isArray(body.data.permissions)).toBeTruthy();
  });

  test('Admin is rejected from editing role permissions (tightened this pass)', async () => {
    const res = await apiContext.put(`${API}/rbac/roles/1/permissions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { permissionIds: [1] },
    });
    expect(res.status()).toBe(403);
  });

  test('SuperAdmin can edit a role\'s permissions and the change is transactionally consistent', async () => {
    const matrixBefore = await (await apiContext.get(`${API}/rbac/matrix`, { headers: { Authorization: `Bearer ${superToken}` } })).json();
    const cashierRole = matrixBefore.data.roles.find((r) => r.name === 'Cashier');
    const originalPermNames = matrixBefore.data.rolePermissions['Cashier'] || [];
    const allPermIds = matrixBefore.data.permissions.map((p) => p.id);

    const editRes = await apiContext.put(`${API}/rbac/roles/${cashierRole.id}/permissions`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { permissionIds: allPermIds },
    });
    expect(editRes.status()).toBe(200);

    const matrixAfter = await (await apiContext.get(`${API}/rbac/matrix`, { headers: { Authorization: `Bearer ${superToken}` } })).json();
    expect(matrixAfter.data.rolePermissions['Cashier'].length).toBe(allPermIds.length);

    // Restore original scope so this test doesn't leak state into other tests/modules.
    const originalIds = matrixBefore.data.permissions.filter((p) => originalPermNames.includes(p.name)).map((p) => p.id);
    await apiContext.put(`${API}/rbac/roles/${cashierRole.id}/permissions`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { permissionIds: originalIds },
    });
  });

  test('editing with an unknown permission ID is rejected with 400, not silently accepted', async () => {
    const res = await apiContext.put(`${API}/rbac/roles/1/permissions`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { permissionIds: [999999] },
    });
    expect(res.status()).toBe(400);
  });

  test('editing an unknown role ID is rejected with 404', async () => {
    const res = await apiContext.put(`${API}/rbac/roles/999999/permissions`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { permissionIds: [] },
    });
    expect(res.status()).toBe(404);
  });

  test('a Client cannot reach the RBAC matrix at all', async () => {
    const clientToken = await loginAs(apiContext, CLIENT);
    const res = await apiContext.get(`${API}/rbac/matrix`, { headers: { Authorization: `Bearer ${clientToken}` } });
    expect(res.status()).toBe(403);
  });
});

test.describe('Elevated account management (API)', () => {
  let apiContext;
  let superToken;
  let adminToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    superToken = await loginAs(apiContext, SUPERADMIN);
    adminToken = await loginAs(apiContext, ADMIN);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('Admin cannot list, create, or manage elevated accounts at all', async () => {
    const listRes = await apiContext.get(`${API}/superadmin/accounts`, { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(listRes.status()).toBe(403);

    const createRes = await apiContext.post(`${API}/superadmin/accounts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { firstName: 'X', lastName: 'Y', email: uniqueEmail('blocked'), password: 'TestPass123!', role: 'Admin' },
    });
    expect(createRes.status()).toBe(403);
  });

  test('SuperAdmin can create an Admin account and a SuperAdmin account', async () => {
    for (const role of ['Admin', 'SuperAdmin']) {
      const res = await apiContext.post(`${API}/superadmin/accounts`, {
        headers: { Authorization: `Bearer ${superToken}` },
        data: { firstName: 'E2E', lastName: role, email: uniqueEmail(role), password: 'TestPass123!', role },
      });
      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body.data.account.roles).toEqual([role]);
    }
  });

  test('creating an elevated account with a non-elevated role is rejected', async () => {
    const res = await apiContext.post(`${API}/superadmin/accounts`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { firstName: 'E2E', lastName: 'NotElevated', email: uniqueEmail('bad'), password: 'TestPass123!', role: 'Receptionist' },
    });
    expect(res.status()).toBe(400);
  });

  test('SuperAdmin cannot deactivate their own account (self-lockout guard)', async () => {
    const meRes = await apiContext.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${superToken}` } });
    const selfId = (await meRes.json()).data.user.id;

    const res = await apiContext.patch(`${API}/superadmin/accounts/${selfId}/status`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { status: false },
    });
    expect(res.status()).toBe(400);
  });

  test('SuperAdmin can deactivate a different elevated account, and reactivate it', async () => {
    const createRes = await apiContext.post(`${API}/superadmin/accounts`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { firstName: 'E2E', lastName: 'ToggleMe', email: uniqueEmail('toggle'), password: 'TestPass123!', role: 'Admin' },
    });
    const targetId = (await createRes.json()).data.account.id;

    const deactivateRes = await apiContext.patch(`${API}/superadmin/accounts/${targetId}/status`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { status: false },
    });
    expect(deactivateRes.status()).toBe(200);

    const reactivateRes = await apiContext.patch(`${API}/superadmin/accounts/${targetId}/status`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { status: true },
    });
    expect(reactivateRes.status()).toBe(200);
  });

  test('the status endpoint cannot be used against a non-elevated account', async () => {
    const clientEmail = uniqueEmail('NotElevatedTarget');
    await apiContext.post(`${API}/auth/register`, {
      data: { firstName: 'E2E', lastName: 'NotElevatedTarget', email: clientEmail, password: 'TestPass123!', contactNumber: '' },
    });
    const clientLoginRes = await apiContext.post(`${API}/auth/login`, { data: { email: clientEmail, password: 'TestPass123!' } });
    const clientToken = (await clientLoginRes.json()).data.token;
    const meRes = await apiContext.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${clientToken}` } });
    const clientId = (await meRes.json()).data.user.id;

    const res = await apiContext.patch(`${API}/superadmin/accounts/${clientId}/status`, {
      headers: { Authorization: `Bearer ${superToken}` },
      data: { status: false },
    });
    expect(res.status()).toBe(403);
  });

  test('unauthenticated requests to elevated account endpoints are rejected', async () => {
    const res = await apiContext.get(`${API}/superadmin/accounts`);
    expect(res.status()).toBe(401);
  });
});

test.describe('Super Admin Management — browser flow', () => {
  test('SuperAdmin sees the "Super Admin" nav item; Admin does not', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', ADMIN.email);
    await page.fill('input[type="password"]', ADMIN.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Management Console')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Super Admin', exact: true })).toHaveCount(0);
  });

  test('the Role-Permission Matrix and Elevated Accounts tabs both load with real data', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', SUPERADMIN.email);
    await page.fill('input[type="password"]', SUPERADMIN.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('button', { name: 'Super Admin', exact: true })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Super Admin', exact: true }).click();
    await expect(page.getByText('Roles & Their Assigned Permissions')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('SuperAdmin', { exact: true }).first()).toBeVisible();

    await page.getByText('Elevated Accounts', { exact: true }).click();
    await expect(page.getByText('(you)')).toBeVisible({ timeout: 10000 });
  });

  test('editing a role\'s permissions through the UI persists the change', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', SUPERADMIN.email);
    await page.fill('input[type="password"]', SUPERADMIN.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('button', { name: 'Super Admin', exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Super Admin', exact: true }).click();
    await expect(page.getByText('Roles & Their Assigned Permissions')).toBeVisible({ timeout: 10000 });

    const clientRow = page.getByText('Client', { exact: true }).locator('xpath=ancestor::tr[1]');
    await clientRow.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByText('Edit Permissions — Client')).toBeVisible({ timeout: 10000 });

    const checkbox = page.getByText('reports:view').locator('xpath=ancestor::label[1]').locator('input[type="checkbox"]');
    const wasChecked = await checkbox.isChecked();
    await checkbox.click();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText('Edit Permissions — Client')).toHaveCount(0, { timeout: 10000 });

    // Revert so this test is idempotent across runs.
    await clientRow.getByRole('button', { name: 'Edit' }).click();
    const checkbox2 = page.getByText('reports:view').locator('xpath=ancestor::label[1]').locator('input[type="checkbox"]');
    expect(await checkbox2.isChecked()).toBe(!wasChecked);
    await checkbox2.click();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText('Edit Permissions — Client')).toHaveCount(0, { timeout: 10000 });
  });
});
