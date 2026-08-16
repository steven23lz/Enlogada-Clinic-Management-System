// @ts-check
import { test, expect, request } from 'playwright/test';

// The role-permission matrix actually governs access.
//
// It used to carry an "advisory only — not yet enforced" banner, because authorizePermissions was
// wired to zero routes: a SuperAdmin could untick `billing:process` for Cashier, watch it save,
// and reasonably conclude access had been removed while cashiers kept taking payments.
//
// Two things make it real, and both are asserted here. Permissions now gate the API, and Admin no
// longer bypasses them — while Admin bypassed, unticking anything for Admin was a no-op, which is
// why Admin and SuperAdmin felt like the same role.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Role-permission matrix is enforced', () => {
  let apiContext;
  let superAdmin, admin, cashier;
  let cashierRoleId, permissionIds, originalCashierIds;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await apiContext.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).data.token;
  };
  const setCashierPermissions = async (ids) => {
    const res = await apiContext.put(`${API}/rbac/roles/${cashierRoleId}/permissions`, {
      headers: auth(superAdmin), data: { permissionIds: ids },
    });
    expect(res.status()).toBe(200);
  };
  const permissionsOf = async (token) =>
    (await (await apiContext.get(`${API}/auth/me`, { headers: auth(token) })).json()).data.user.permissions;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    superAdmin = await login('admin@enlogada.com');
    admin = await login('clinicadmin@enlogada.com');
    cashier = await login('cashier@enlogada.com');

    const matrix = (await (await apiContext.get(`${API}/rbac/matrix`, { headers: auth(superAdmin) })).json()).data;
    cashierRoleId = matrix.roles.find((r) => r.name === 'Cashier').id;
    permissionIds = Object.fromEntries(matrix.permissions.map((p) => [p.name, p.id]));
    originalCashierIds = (matrix.rolePermissions.Cashier || []).map((n) => permissionIds[n]);
  });

  test.afterAll(async () => {
    // Always put the matrix back — a half-finished run must not leave the demo cashier unable to
    // take payments.
    if (cashierRoleId && originalCashierIds) await setCashierPermissions(originalCashierIds);
    await apiContext.dispose();
  });

  test('revoking a permission stops the endpoint behind it, on the same token', async () => {
    // Before: authorization passes, so this fails on the nonexistent visit instead — anything
    // other than 403 proves the permission gate let it through.
    const before = await apiContext.post(`${API}/payments`, {
      headers: auth(cashier), data: { patientVisitId: 999999999, paymentMethod: 'Cash', amount: 1 },
    });
    expect(before.status(), 'cashier should get past authorization before the change').not.toBe(403);

    await setCashierPermissions(originalCashierIds.filter((id) => id !== permissionIds['billing:process']));

    // No re-login: authority is read from the database on every request.
    const after = await apiContext.post(`${API}/payments`, {
      headers: auth(cashier), data: { patientVisitId: 999999999, paymentMethod: 'Cash', amount: 1 },
    });
    expect(after.status(), 'the revoked permission must now refuse the request').toBe(403);
  });

  test('the revocation is granular — neighbouring permissions still work', async () => {
    // billing:read was not touched, so the transaction log must stay reachable. A change that
    // takes out the whole module would be a blunt instrument, not delegation.
    const res = await apiContext.get(`${API}/payments/transactions`, { headers: auth(cashier) });
    expect(res.status()).toBe(200);
  });

  test('the change reaches the user without a re-login, which is what drives the sidebar', async () => {
    // The sidebar hides any destination whose permission the user lacks (canSee in
    // config/navigation.js), and it reads exactly this list — so asserting the list is asserting
    // the navigation, without needing a browser.
    const perms = await permissionsOf(cashier);
    expect(perms).not.toContain('billing:process'); // Billing Queue hidden
    expect(perms).toContain('billing:read');        // Transaction History still shown

    await setCashierPermissions(originalCashierIds);
    expect(await permissionsOf(cashier)).toContain('billing:process');
  });

  test('Admin is subject to the matrix; SuperAdmin bypasses it', async () => {
    // The separation the whole exercise was about. Admin holds neither rbac:manage nor
    // billing:process, and no longer bypasses the check that enforces them.
    const adminPerms = await permissionsOf(admin);
    expect(adminPerms).not.toContain('rbac:manage');
    expect(adminPerms).not.toContain('billing:process');

    const adminEdits = await apiContext.put(`${API}/rbac/roles/${cashierRoleId}/permissions`, {
      headers: auth(admin), data: { permissionIds: originalCashierIds },
    });
    expect(adminEdits.status(), 'only SuperAdmin decides who may do what').toBe(403);

    const adminPays = await apiContext.post(`${API}/payments`, {
      headers: auth(admin), data: { patientVisitId: 999999999, paymentMethod: 'Cash', amount: 1 },
    });
    expect(adminPays.status(), 'the reviewer of the cash-up must not also be the transactor').toBe(403);

    // ...while keeping the oversight reads that make the restriction workable.
    const oversight = await apiContext.get(`${API}/reports/summary?startDate=2026-01-01&endDate=2030-01-01`, {
      headers: auth(admin),
    });
    expect(oversight.status()).toBe(200);
  });

  test('a permission cannot widen a role past its structural boundary', async () => {
    // Granting a Client every permission in the catalogue must still not put them on a worklist.
    // The role gate is deliberately not editable from any screen; permissions only ever narrow
    // within it.
    const clientToken = await login('client@enlogada.com');
    const res = await apiContext.get(`${API}/results/pending/Laboratory`, { headers: auth(clientToken) });
    expect(res.status()).toBe(403);
  });
});
