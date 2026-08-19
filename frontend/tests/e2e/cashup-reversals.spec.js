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
 * endpoint returned; every one of them would have begun counting refunds as revenue. So the two
 * halves are tested together here — the list showing MORE while the total shows the SAME is the
 * whole invariant, and asserting either alone would pass while the pair was broken.
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
  const labTest = (await testsRes.json()).data.tests.filter((t) => t.category_name === 'Laboratory')[0];
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

  test('the refunded amount leaves collections and is reported as a reversal', async () => {
    const patient = await registerClientWithPatient(apiContext, 'RefundTotals');
    const payment = await payAWalkIn(apiContext, recToken, cashToken, patient.id);
    const amount = parseFloat(payment.amount);

    const before = await getLog(apiContext, cashToken);
    await refund(apiContext, cashToken, payment.id, 'Reversed for the totals assertion.');
    const after = await getLog(apiContext, cashToken);

    // Collections drop by exactly the refund; the receipt count drops by one.
    expect(Number(after.summary.collected)).toBeCloseTo(Number(before.summary.collected) - amount, 2);
    expect(after.summary.receipts).toBe(before.summary.receipts - 1);

    // The money is named rather than silently dropped. A drawer short by a refund needs the
    // refund on screen, which is why `reversed` is reported instead of netted off `collected`.
    expect(Number(after.summary.reversed)).toBeCloseTo(Number(before.summary.reversed) + amount, 2);
    expect(after.summary.reversals).toBe(before.summary.reversals + 1);

    // The row is still in the list, so the list is now larger than the money in it. That pairing
    // is exactly what makes a client-side reduce() over these rows wrong, and it is asserted
    // here so re-deriving a total from the list fails in CI rather than on a cash-up sheet.
    expect(after.transactions.length).toBe(before.transactions.length);
    const naiveSum = after.transactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    expect(naiveSum).toBeGreaterThan(Number(after.summary.collected));
    expect(naiveSum).toBeCloseTo(Number(after.summary.collected) + Number(after.summary.reversed), 2);
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
