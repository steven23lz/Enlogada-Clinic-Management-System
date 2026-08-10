// @ts-check
import { test, expect, request } from 'playwright/test';

// Module 8 (Cashier) coverage. The POS/billing terminal (bill computation, payment methods,
// receipt printing, transaction log) was already fully built and correct; the one real gap
// found on inspection was that GET /visits/active returns both 'Pending' and 'Processing'
// visits, and a visit stays 'Processing' after payment — so an already-paid visit remained
// fully selectable and payable again in the "Pending Billing Queue" with zero protection
// against double-billing a patient. Fixed entirely within CashierDashboard.jsx by
// cross-referencing the payments data it already fetches.
//
// Two related, deeper gaps were found but NOT fixed here, per module boundary discipline —
// they live in paymentService.js, which MODULE_SCOPE.md assigns to Module 14 (Payment):
//   1. HMO coverage is a blanket 100% discount from patient_type_name alone, with no check
//      against actual hmo_requests approval status (Module 15).
//   2. processPayment trusts the client-submitted amount and has no server-side idempotency
//      guard against a duplicate/replayed payment for the same visit.
// See the Escalation rows in .agents/TRACEABILITY.md.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const CASHIER = { email: 'cashier@enlogada.com', password: 'Password123!' };
const CLIENT = { email: 'client@enlogada.com', password: 'Password123!' };

function uniqueName(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

async function createBillableVisit(apiContext, recToken, categoryName = 'Laboratory') {
  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientTypeId: 2, firstName: 'M8', lastName: uniqueName('Fixture'), birthdate: '1990-01-01', sex: 'Male', address: 'Addr', contactNumber: '09170000000', emergencyContact: '' },
  });
  const patient = (await patientRes.json()).data.patient;

  const visitRes = await apiContext.post(`${API}/visits`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientId: patient.id, visitType: 'Walk in', notes: '' },
  });
  const visit = (await visitRes.json()).data.visit;

  const testsRes = await apiContext.get(`${API}/tests`);
  const test_ = (await testsRes.json()).data.tests.find((t) => t.category_name === categoryName);

  await apiContext.post(`${API}/tests/visit-tests`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientVisitId: visit.id, testIds: [test_.id] },
  });

  return { patient, visit, test: test_ };
}

test.describe('Billing (API)', () => {
  let apiContext;
  let recToken;
  let cashToken;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    recToken = await loginAs(apiContext, RECEPTIONIST);
    cashToken = await loginAs(apiContext, CASHIER);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('bill summary totals match the attached test price', async () => {
    const { visit, test: t } = await createBillableVisit(apiContext, recToken);
    const res = await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: { Authorization: `Bearer ${cashToken}` } });
    expect(res.status()).toBe(200);
    const bill = (await res.json()).data.bill;
    expect(parseFloat(bill.totalAmount)).toBeCloseTo(parseFloat(t.price), 2);
  });

  test('a Client role cannot reach the cashier billing endpoint', async () => {
    const { visit } = await createBillableVisit(apiContext, recToken);
    const clientToken = await loginAs(apiContext, CLIENT);
    const res = await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: { Authorization: `Bearer ${clientToken}` } });
    expect(res.status()).toBe(403);
  });

  test('unauthenticated billing request is rejected', async () => {
    const { visit } = await createBillableVisit(apiContext, recToken);
    const res = await apiContext.get(`${API}/payments/bill/${visit.id}`);
    expect(res.status()).toBe(401);
  });

  test('processing a payment returns a receipt number and appears in the transaction log', async () => {
    const { visit } = await createBillableVisit(apiContext, recToken);
    const billRes = await apiContext.get(`${API}/payments/bill/${visit.id}`, { headers: { Authorization: `Bearer ${cashToken}` } });
    const bill = (await billRes.json()).data.bill;

    const payRes = await apiContext.post(`${API}/payments`, {
      headers: { Authorization: `Bearer ${cashToken}` },
      data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: bill.totalAmount },
    });
    expect(payRes.status()).toBe(201);
    const payment = (await payRes.json()).data.payment;
    expect(payment.receipt_number).toMatch(/^RCT-\d{8}-\d{4}$/);

    const txRes = await apiContext.get(`${API}/payments/transactions`, { headers: { Authorization: `Bearer ${cashToken}` } });
    const transactions = (await txRes.json()).data.transactions;
    expect(transactions.some((t) => t.id === payment.id)).toBeTruthy();
  });
});

test.describe('Cashier — browser flow', () => {
  test('an already-paid visit disappears from the Pending Billing Queue (double-billing guard)', async ({ page }) => {
    const apiContext = await request.newContext();
    const recToken = await loginAs(apiContext, RECEPTIONIST);
    const { visit, patient } = await createBillableVisit(apiContext, recToken);
    await apiContext.dispose();

    await page.goto('/');
    await page.getByText('Sign In', { exact: true }).first().click();
    await page.fill('input[type="email"]', CASHIER.email);
    await page.fill('input[type="password"]', CASHIER.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Pending Billing Queue')).toBeVisible({ timeout: 10000 });

    const queuePanel = page.locator('text=Pending Billing Queue').locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
    const patientLabel = `M8 ${patient.last_name}`;

    await expect(queuePanel.getByText(patientLabel)).toBeVisible({ timeout: 10000 });
    await queuePanel.getByText(patientLabel).click();

    await page.getByRole('button', { name: 'Exact' }).click();
    await page.getByRole('button', { name: 'Process Checkout Payment & Issue Official Receipt' }).click();
    await page.getByRole('button', { name: 'Confirm & Process' }).click();
    await expect(page.getByText('Official Payment Receipt')).toBeVisible({ timeout: 10000 });

    await page.keyboard.press('Escape');
    await expect(queuePanel.getByText(patientLabel)).toHaveCount(0, { timeout: 10000 });
  });
});
