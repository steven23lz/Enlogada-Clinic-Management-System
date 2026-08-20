// @ts-check
import { test, expect, request } from 'playwright/test';

/**
 * A reversed receipt must stay in the cash-up log, and must stay out of the total.
 *
 * GET /payments/transactions used to filter `payment_status = 'Paid'`, so reversing a receipt
 * deleted it from the cashier's own log — while the screen above that log said, in two places,
 * "refunds and cancellations are recorded against the original receipt". For a daily cash-up
 * that is backwards: the receipt a cashier most needs to account for is the one they had to
 * reverse, and the drawer is short by an amount with nothing on screen to explain it.
 *
 * The fix widened the list, which is only safe because the peso figures stopped being derived
 * from it. Ten client-side reduce() calls across four screens used to sum whatever rows the
 * endpoint returned; every one of them would have begun counting refunds as revenue.
 *
 * [1.30.0] The figures are a period cash book: money IN bucketed by paid_at, money BACK bucketed
 * by refunded_at, and `net` the difference. Collections are therefore never restated — a day that
 * has been printed and filed keeps saying what it said — and a reversal lands on the day the
 * drawer is actually short rather than on the day the receipt was originally issued.
 *
 * NOTE ON WORKERS: these tests assert exact deltas on the day's live totals, so they require the
 * single worker playwright.config.js already sets. A second worker taking a payment concurrently
 * would move `collected` between the two reads here and fail this file for a reason that is not a
 * bug. Same constraint as the permission and password specs, for money rather than for state.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };
const CASHIER = { email: 'cashier@enlogada.com', password: 'Password123!' };

const uniqueName = (prefix) => `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`;

async function loginAs(apiContext, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

async function registerClientWithPatient(apiContext, prefix) {
  const email = `${uniqueName(prefix)}@enlogada-e2e.test`;
  const password = 'TestPass123!';
  await apiContext.post(`${API}/auth/register`, {
    data: { firstName: 'E2E', lastName: prefix, email, password, contactNumber: '' },
  });
  const loginRes = await apiContext.post(`${API}/auth/login`, { data: { email, password } });
  const token = (await loginRes.json()).data.token;

  const typesRes = await apiContext.get(`${API}/patients/types`, { headers: { Authorization: `Bearer ${token}` } });
  const patientType = (await typesRes.json()).data.patientTypes.find((t) => t.name === 'Self Pay');

  const patientRes = await apiContext.post(`${API}/patients`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      patientTypeId: patientType.id, firstName: 'E2E', lastName: `${prefix}Patient`,
      birthdate: '1990-01-01', sex: 'Male', address: 'Addr', contactNumber: '', emergencyContact: '',
    },
  });
  return (await patientRes.json()).data.patient;
}

/** A settled walk-in receipt, ready to be reversed. */
async function payAWalkIn(apiContext, recToken, cashToken, patientId) {
  const visitRes = await apiContext.post(`${API}/visits`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientId, visitType: 'Walk in', notes: '' },
  });
  const visit = (await visitRes.json()).data.visit;

  const testsRes = await apiContext.get(`${API}/tests`);
  // find + assert, so a catalogue with no Laboratory test fails saying that, rather than
  // throwing a TypeError on `.id` twenty lines later.
  const labTest = (await testsRes.json()).data.tests.find((t) => t.category_name === 'Laboratory');
  expect(labTest, 'the catalogue needs at least one Laboratory test for this fixture').toBeTruthy();
  await apiContext.post(`${API}/tests/visit-tests`, {
    headers: { Authorization: `Bearer ${recToken}` },
    data: { patientVisitId: visit.id, testIds: [labTest.id] },
  });

  const billRes = await apiContext.get(`${API}/payments/bill/${visit.id}`, {
    headers: { Authorization: `Bearer ${cashToken}` },
  });
  const bill = (await billRes.json()).data.bill;

  const payRes = await apiContext.post(`${API}/payments`, {
    headers: { Authorization: `Bearer ${cashToken}` },
    data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: bill.totalAmount },
  });
  expect(payRes.status()).toBe(201);
  return (await payRes.json()).data.payment;
}

async function getLog(apiContext, token) {
  const res = await apiContext.get(`${API}/payments/transactions`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()).data;
}

async function refund(apiContext, token, paymentId, reason) {
  return apiContext.patch(`${API}/payments/${paymentId}/status`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { status: 'Refunded', reason },
  });
}

test.describe('a reversed receipt stays in the cash-up, and stays out of the total', () => {
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

  test('the receipt is still listed after it is refunded, carrying its new status', async () => {
    const patient = await registerClientWithPatient(apiContext, 'RefundListed');
    const payment = await payAWalkIn(apiContext, recToken, cashToken, patient.id);

    const before = await getLog(apiContext, cashToken);
    expect(before.transactions.some((t) => t.id === payment.id)).toBe(true);

    const res = await refund(apiContext, cashToken, payment.id, 'Duplicate charge at the counter.');
    expect(res.ok()).toBe(true);

    // The regression this file exists for: the row used to vanish at exactly this point.
    const after = await getLog(apiContext, cashToken);
    const row = after.transactions.find((t) => t.id === payment.id);
    expect(row).toBeTruthy();
    expect(row.payment_status).toBe('Refunded');
    expect(row.receipt_number).toBe(payment.receipt_number);
  });

  test('a reversal is reported beside collections, and does not restate them', async () => {
    const patient = await registerClientWithPatient(apiContext, 'RefundTotals');
    const payment = await payAWalkIn(apiContext, recToken, cashToken, patient.id);
    const amount = parseFloat(payment.amount);

    const before = await getLog(apiContext, cashToken);
    await refund(apiContext, cashToken, payment.id, 'Reversed for the totals assertion.');
    const after = await getLog(apiContext, cashToken);

    // Collections do NOT move. [1.30.0] This receipt was money taken in today, and it stays
    // counted on the day it was taken whatever happens to it afterwards — otherwise reversing an
    // older receipt silently rewrites a day that has already been printed and filed, and the
    // sheet in the drawer stops agreeing with the screen with no way to tell which is right.
    expect(Number(after.summary.collected)).toBeCloseTo(Number(before.summary.collected), 2);
    expect(after.summary.receipts).toBe(before.summary.receipts);

    // The refund is reported beside it, bucketed by when it was HANDED BACK rather than when the
    // money came in, so it lands on the day the drawer is actually short.
    expect(Number(after.summary.reversed)).toBeCloseTo(Number(before.summary.reversed) + amount, 2);
    expect(after.summary.reversals).toBe(before.summary.reversals + 1);

    // What the drawer should hold. `reversed` is never netted off `collected` in the response,
    // because a single reconciled total hides that a reversal happened — but the two together
    // are the figure a cashier counts against, and it is this that drops by the refund.
    const netBefore = Number(before.summary.collected) - Number(before.summary.reversed);
    const netAfter = Number(after.summary.collected) - Number(after.summary.reversed);
    expect(netAfter).toBeCloseTo(netBefore - amount, 2);

    // And a reduce over the rows is still not any of these numbers — it counts the reversed
    // receipt at full value, which is exactly why the peso figures come from `summary`.
    const naiveSum = after.transactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    expect(naiveSum).toBeGreaterThan(netAfter);
  });

  test('the method splits add up to the collected total', async () => {
    const { summary } = await getLog(apiContext, cashToken);

    // chk_payment_method allows exactly ('Cash', 'GCash', 'PayMaya', 'Bank'), so these three
    // figures are the whole of `collected` and must reconcile to it. They did not before: only
    // Cash and E-Wallet had tiles, so a day carrying a bank transfer showed a total that the
    // splits beneath it could not account for — ₱200.00 unexplained on the day this was found.
    const parts = Number(summary.cash) + Number(summary.ewallet) + Number(summary.bank);
    expect(parts).toBeCloseTo(Number(summary.collected), 2);
  });

  test('the summary describes the whole range, not the page in hand', async () => {
    const whole = await getLog(apiContext, cashToken);

    const p1 = await apiContext.get(`${API}/payments/transactions?limit=5&page=1`, {
      headers: { Authorization: `Bearer ${cashToken}` },
    });
    const p2 = await apiContext.get(`${API}/payments/transactions?limit=5&page=2`, {
      headers: { Authorization: `Bearer ${cashToken}` },
    });
    const page1 = (await p1.json()).data;
    const page2 = (await p2.json()).data;

    // A paged caller reducing the rows it holds would total one page and label it the day.
    expect(page1.summary.collected).toBe(whole.summary.collected);
    expect(page2.summary.collected).toBe(whole.summary.collected);
    expect(page1.summary.receipts).toBe(whole.summary.receipts);
  });

  test('only receipts that were actually issued appear — no unsettled checkout sessions', async () => {
    const { transactions } = await getLog(apiContext, cashToken);
    expect(transactions.length).toBeGreaterThan(0);

    // A 'Pending' online checkout carries no receipt number: the number is assigned on
    // settlement and never before. That is what keeps an abandoned gateway session — money the
    // clinic never took — out of a log otherwise widened to include reversals. paid_at cannot
    // do this job; it is DEFAULT CURRENT_TIMESTAMP, so a pending row carries one too.
    for (const t of transactions) {
      expect(t.receipt_number).toBeTruthy();
      expect(['Paid', 'Refunded', 'Cancelled']).toContain(t.payment_status);
    }
  });
});

test('the cashier sees the reversal on the transaction history screen', async ({ page }) => {
  const apiContext = await request.newContext();
  const recToken = await loginAs(apiContext, RECEPTIONIST);
  const cashToken = await loginAs(apiContext, CASHIER);
  const patient = await registerClientWithPatient(apiContext, 'RefundUi');
  const payment = await payAWalkIn(apiContext, recToken, cashToken, patient.id);
  await refund(apiContext, cashToken, payment.id, 'Reversed for the on-screen assertion.');
  await apiContext.dispose();

  await page.goto('/');
  await page.getByText('Sign In', { exact: true }).first().click();
  await page.fill('input[type="email"]', CASHIER.email);
  await page.fill('input[type="password"]', CASHIER.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText(/billing|terminal|queue/i).first()).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: /transaction history/i }).first().click();

  const row = page.locator('tr', { hasText: payment.receipt_number });
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row.getByText('Refunded')).toBeVisible();

  // Refund is not offered a second time on a receipt that has already been reversed.
  await expect(row.getByRole('button', { name: /refund/i })).toHaveCount(0);
});
