// @ts-check
import { test, expect, request } from 'playwright/test';

// Module 18 (Notification) coverage. Before this module, SidebarLayout.jsx rendered a hardcoded
// static array of 3 fake notifications, identically, for every staff/admin user regardless of
// role or any real event — there was no backend at all (confirmed on inspection: no
// `notifications` table, no notification-related code anywhere).
//
// This module built the first real notification system: a `notifications` table (one row per
// recipient per event, so each recipient has an independent read state), a self-scoped
// GET/PATCH backend, and three real trigger points wired into already-approved services —
// appointment booking (Module 3/7), payment processing (Module 14), and result release
// (Module 16) — matching MODULE_SCOPE.md's own named examples ("appointment/result/payment
// events"). Recipients are staff/admin only, matching where the notification bell UI actually
// lives (DashboardLayout.jsx, the Client shell, has never had one).

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const CASHIER = { email: 'cashier@enlogada.com', password: 'Password123!' };
const LAB_STAFF = { email: 'lab@enlogada.com', password: 'Password123!' };
const SUPERADMIN = { email: 'admin@enlogada.com', password: 'Password123!' };
const ADMIN = { email: 'clinicadmin@enlogada.com', password: 'Password123!' };

function uniqueEmail(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}@enlogada-e2e.test`;
}

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

async function unreadCountFor(apiContext, token) {
  const res = await apiContext.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()).data.unreadCount;
}

async function findAvailableSlot(apiContext, token) {
  for (let offset = 1; offset <= 14; offset++) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const res = await apiContext.get(`${API}/appointments/availability?date=${dateStr}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    if (body.data?.isOpen) {
      const slot = body.data.slots.find((s) => s.available);
      if (slot) return { scheduledDate: dateStr, scheduledTime: slot.time };
    }
  }
  throw new Error('No available slot found in the next 14 days');
}

async function registerClientWithPatient(apiContext, prefix) {
  const email = uniqueEmail(prefix);
  const password = 'TestPass123!';
  await apiContext.post(`${API}/auth/register`, { data: { firstName: 'M18', lastName: prefix, email, password, contactNumber: '' } });
  const loginRes = await apiContext.post(`${API}/auth/login`, { data: { email, password } });
  const token = (await loginRes.json()).data.token;
  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { patientTypeId: 2, firstName: 'M18', lastName: `${prefix}Patient`, birthdate: '1990-01-01', sex: 'Male', address: '', contactNumber: '', emergencyContact: '' },
  });
  const patient = (await patientRes.json()).data.patient;
  return { token, patient };
}

test.describe('Notification triggers (API)', () => {
  let apiContext;
  let recToken;
  let cashierToken;
  let labToken;
  let superToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginAs(apiContext, RECEPTIONIST);
    cashierToken = await loginAs(apiContext, CASHIER);
    labToken = await loginAs(apiContext, LAB_STAFF);
    superToken = await loginAs(apiContext, SUPERADMIN);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('booking an appointment notifies Receptionist and SuperAdmin, not Cashier', async () => {
    const { token: clientToken, patient } = await registerClientWithPatient(apiContext, 'Appt');
    const { scheduledDate, scheduledTime } = await findAvailableSlot(apiContext, clientToken);

    const beforeRec = await unreadCountFor(apiContext, recToken);
    const beforeCashier = await unreadCountFor(apiContext, cashierToken);
    const beforeSuper = await unreadCountFor(apiContext, superToken);

    const apptRes = await apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      data: { patientId: patient.id, scheduledDate, scheduledTime, notes: '' },
    });
    expect(apptRes.status()).toBe(201);

    expect(await unreadCountFor(apiContext, recToken)).toBeGreaterThan(beforeRec);
    expect(await unreadCountFor(apiContext, superToken)).toBeGreaterThan(beforeSuper);
    expect(await unreadCountFor(apiContext, cashierToken)).toBe(beforeCashier);

    const recNotifs = await apiContext.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${recToken}` } });
    const latest = (await recNotifs.json()).data.notifications[0];
    expect(latest.title).toBe('New Appointment Booked');
  });

  test('processing a payment notifies SuperAdmin, not the processing Cashier', async () => {
    const walkinRes = await apiContext.post(`${API}/patients`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientTypeId: 3, firstName: 'M18', lastName: 'PayWalkin', birthdate: '1985-01-01', sex: 'Female', address: '', contactNumber: '', emergencyContact: '' },
    });
    const patient = (await walkinRes.json()).data.patient;
    const visitRes = await apiContext.post(`${API}/visits`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientId: patient.id, visitType: 'Walk in', notes: '' },
    });
    const visit = (await visitRes.json()).data.visit;
    const testsRes = await apiContext.get(`${API}/tests`);
    const labTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Laboratory');
    await apiContext.post(`${API}/tests/visit-tests`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientVisitId: visit.id, testIds: [labTest.id] },
    });
    const billRes = await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: { Authorization: `Bearer ${cashierToken}` } });
    const bill = (await billRes.json()).data.bill;

    const beforeSuper = await unreadCountFor(apiContext, superToken);
    const beforeCashier = await unreadCountFor(apiContext, cashierToken);

    const payRes = await apiContext.post(`${API}/payments`, {
      headers: { Authorization: `Bearer ${cashierToken}` },
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', referenceNumber: '', amount: bill.totalAmount },
    });
    expect(payRes.status()).toBe(201);

    expect(await unreadCountFor(apiContext, superToken)).toBeGreaterThan(beforeSuper);
    expect(await unreadCountFor(apiContext, cashierToken)).toBe(beforeCashier);

    const superNotifs = await apiContext.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${superToken}` } });
    const latest = (await superNotifs.json()).data.notifications[0];
    expect(latest.title).toBe('Payment Confirmed');
  });

  test('releasing a result notifies SuperAdmin, not the releasing Lab Staff', async () => {
    const walkinRes = await apiContext.post(`${API}/patients`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientTypeId: 3, firstName: 'M18', lastName: 'ResultWalkin', birthdate: '1985-01-01', sex: 'Female', address: '', contactNumber: '', emergencyContact: '' },
    });
    const patient = (await walkinRes.json()).data.patient;
    const visitRes = await apiContext.post(`${API}/visits`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientId: patient.id, visitType: 'Walk in', notes: '' },
    });
    const visit = (await visitRes.json()).data.visit;
    const testsRes = await apiContext.get(`${API}/tests`);
    const labTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Laboratory');
    const vtRes = await apiContext.post(`${API}/tests/visit-tests`, {
      headers: { Authorization: `Bearer ${recToken}` },
      data: { patientVisitId: visit.id, testIds: [labTest.id] },
    });
    const visitTest = (await vtRes.json()).data.visitTests[0];
    await apiContext.post(`${API}/results/${visitTest.id}`, {
      headers: { Authorization: `Bearer ${labToken}` },
      data: { findings: 'M18 test findings', remarks: '', fileUrl: null },
    });

    const beforeSuper = await unreadCountFor(apiContext, superToken);
    const beforeLab = await unreadCountFor(apiContext, labToken);

    const releaseRes = await apiContext.post(`${API}/results/${visitTest.id}/release`, { headers: { Authorization: `Bearer ${labToken}` } });
    expect(releaseRes.status()).toBe(200);

    expect(await unreadCountFor(apiContext, superToken)).toBeGreaterThan(beforeSuper);
    expect(await unreadCountFor(apiContext, labToken)).toBe(beforeLab);

    const superNotifs = await apiContext.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${superToken}` } });
    const latest = (await superNotifs.json()).data.notifications[0];
    expect(latest.title).toBe('Result Released');
  });
});

test.describe('Notification API — read state, ownership, auth', () => {
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

  test('marking a notification as read persists, without touching any other notification\'s read state', async () => {
    // Asserts against the specific marked row, not the aggregate unread count — superToken is a
    // broadcast recipient shared with every other role-notified trigger test in this suite, so
    // under parallel workers a concurrent test's insert can land between two count reads and
    // make an exact-delta assertion flaky, even though the marked row's own state is correct.
    const listRes = await apiContext.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${superToken}` } });
    const unread = (await listRes.json()).data.notifications.find((n) => !n.is_read);
    test.skip(!unread, 'no unread notification available to mark — depends on trigger tests having run');

    const markRes = await apiContext.patch(`${API}/notifications/${unread.id}/read`, { headers: { Authorization: `Bearer ${superToken}` } });
    expect(markRes.status()).toBe(200);
    expect((await markRes.json()).data.notification.is_read).toBe(true);

    const afterListRes = await apiContext.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${superToken}` } });
    const afterNotifs = (await afterListRes.json()).data.notifications;
    expect(afterNotifs.find((n) => n.id === unread.id).is_read).toBe(true);
  });

  test('mark-all-read marks every notification that existed at that moment as read', async () => {
    // Doesn't assert the aggregate unread count is exactly 0 — superToken is a shared broadcast
    // recipient, and another spec file's trigger test can legitimately insert a brand-new
    // (correctly unread) notification for SuperAdmin in the moment right after this call.
    // Instead, asserts the thing mark-all-read actually promises: nothing that existed before
    // the call is still unread afterward.
    const markAt = new Date();
    const markAllRes = await apiContext.patch(`${API}/notifications/read-all`, { headers: { Authorization: `Bearer ${superToken}` } });
    expect(markAllRes.status()).toBe(200);

    const afterListRes = await apiContext.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${superToken}` } });
    const afterNotifs = (await afterListRes.json()).data.notifications;
    const stillUnreadFromBefore = afterNotifs.filter((n) => !n.is_read && new Date(n.created_at) <= markAt);
    expect(stillUnreadFromBefore).toEqual([]);
  });

  test('a user cannot mark another user\'s notification as read (ownership-scoped, 404 not 403)', async () => {
    const adminNotifs = await apiContext.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const adminNotif = (await adminNotifs.json()).data.notifications[0];
    test.skip(!adminNotif, 'Admin has no notifications to attempt cross-ownership access against');
    const crossRes = await apiContext.patch(`${API}/notifications/${adminNotif.id}/read`, { headers: { Authorization: `Bearer ${superToken}` } });
    expect(crossRes.status()).toBe(404);
  });

  test('marking a nonexistent notification returns 404, not a crash', async () => {
    const res = await apiContext.patch(`${API}/notifications/999999999/read`, { headers: { Authorization: `Bearer ${superToken}` } });
    expect(res.status()).toBe(404);
  });

  test('an authenticated Client gets a real 200 with an empty list, not an error', async () => {
    const { token } = await registerClientWithPatient(apiContext, 'NoNotif');
    const res = await apiContext.get(`${API}/notifications`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.notifications).toEqual([]);
  });

  test('unauthenticated request is rejected with 401', async () => {
    const res = await apiContext.get(`${API}/notifications`);
    expect(res.status()).toBe(401);
  });
});

test.describe('Notification bell — browser flow', () => {
  test('the bell shows a real unread indicator, opens a real dropdown, and mark-all-read clears it', async ({ page }) => {
    const apiContext = await request.newContext();
    const recToken = await loginAs(apiContext, RECEPTIONIST);
    const { token: clientToken, patient } = await registerClientWithPatient(apiContext, 'Bell');
    const { scheduledDate, scheduledTime } = await findAvailableSlot(apiContext, clientToken);
    await apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      data: { patientId: patient.id, scheduledDate, scheduledTime, notes: '' },
    });
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', RECEPTIONIST.email);
    await page.fill('input[type="password"]', RECEPTIONIST.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(1500);

    const bellButton = page.getByRole('button', { name: /Notifications/ });
    await expect(bellButton.locator('.bg-red-500')).toBeVisible({ timeout: 10000 });

    await bellButton.click();
    const ownNotification = page.locator('button', { hasText: 'New Appointment Booked' }).first();
    await expect(ownNotification).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Juan Dela Cruz')).toHaveCount(0);

    // Asserts against this test's own notification row specifically, not the global unread dot
    // — Receptionist is a shared broadcast recipient, and another spec file booking an
    // appointment concurrently could legitimately add a new unread notification right after
    // "Mark all read" fires, which would make a global "no red dot" assertion flaky without
    // indicating any real bug.
    await page.getByRole('button', { name: 'Mark all read' }).click();
    await expect(ownNotification.locator('span.rounded-full')).toHaveCount(0);
  });
});
