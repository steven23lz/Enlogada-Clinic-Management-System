// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo, openScreen } from './helpers/auth.js';
import { backdatePayment } from './helpers/backdate.js';
import { registerClient } from './helpers/accounts.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { patientTypeId } from './helpers/patients.js';
import { dateStr } from './helpers/dates.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';

/**
 * The end-of-day cash count. [1.150.0]
 *
 * The server adds the pieces up itself and judges the drawer against a snapshot of what the till
 * said. A shortage needs a note, a recount needs a reason, and the first count stays on record.
 * Written to pass whether or not today has already been counted: the suite shares a database.
 */

const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const CASHIER = 'multirole@enlogada.com';

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dateStr(d);
};
const today = () => daysAgo(0);

/** Notes for an amount: ₱1,000s, ₱1s, and any centavos as other coins. */
function piecesFor(amount) {
  const pesos = Math.floor(amount);
  const thousands = Math.floor(pesos / 1000);
  const centavos = Math.round((amount - pesos) * 100) / 100;
  return { pieces: { 1000: thousands, 1: pesos - thousands * 1000 }, ...(centavos ? { loose: centavos } : {}) };
}

test.describe('The cash count', () => {
  /** @type {import('playwright/test').APIRequestContext} */
  let ctx;
  let reception, desk, clinicAdmin, lab;
  let labTest;

  const login = async (email) => (await (await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).json()).data.token;
  const dayOf = async (date = today(), token = desk) =>
    (await (await ctx.get(`${API}/cash-counts/day`, { headers: auth(token), params: { date } })).json()).data;
  const save = (data, token = desk) => ctx.post(`${API}/cash-counts`, { headers: auth(token), data });

  /**
   * A walk-in, paid in cash at the till: the money this spec expects to find in the drawer. On a
   * throwaway account's own profile, the only receipt e2eBackdatePayment.js will agree to move.
   */
  async function paidInCash() {
    const person = fixturePerson();
    const { token } = await registerClient(ctx, { ...person, email: fixtureEmail(person), password: PASSWORD });
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, token), firstName: person.firstName, lastName: person.lastName,
        birthdate: '1982-08-21', sex: 'Male', address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, emergencyContact: '',
      },
    })).json()).data.patient;
    const { visit } = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.id, visitType: 'Walk in', notes: '', testIds: [labTest.id] },
    })).json()).data;
    const paid = await payAndReleaseWalkIn(ctx, API, visit.id, desk);
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    return { visit, payment: paid.body.data.payment, amount: Number(labTest.price) };
  }

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [reception, desk, clinicAdmin, lab] = await Promise.all([
      'receptionist@enlogada.com', CASHIER, 'clinicadmin@enlogada.com', 'lab@enlogada.com',
    ].map(login));
    labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests.find((t) => t.category_name === 'Laboratory');
  });

  test.afterAll(async () => { await ctx?.dispose(); });

  test('whoever takes the money counts it; an Admin reads it; a department sees neither', async () => {
    const body = { changeFund: 0, pieces: { 1: 1 }, note: 'Checking who may.' };
    expect((await save(body, clinicAdmin)).status(), 'an Admin reads, and does not count').toBe(403);
    expect((await save(body, reception)).status()).toBe(403);
    expect((await ctx.get(`${API}/cash-counts/day`, { headers: auth(clinicAdmin) })).status()).toBe(200);
    expect((await ctx.get(`${API}/cash-counts`, { headers: auth(clinicAdmin) })).status()).toBe(200);
    expect((await ctx.get(`${API}/cash-counts`, { headers: auth(lab) })).status()).toBe(403);
    expect((await ctx.get(`${API}/cash-counts/day`)).status(), 'no account').toBe(401);
  });

  test('a day to count is real, recent and not ahead; a count is whole notes and an amount', async () => {
    const good = { changeFund: 0, pieces: { 1: 1 }, note: 'Refused anyway.' };
    expect((await save({ ...good, date: daysAgo(-1) })).status(), 'tomorrow').toBe(400);
    expect((await save({ ...good, date: daysAgo(8) })).status(), 'too long ago to answer for').toBe(409);
    expect((await save({ ...good, date: 'soon' })).status()).toBe(400);
    expect((await save({ ...good, changeFund: '' })).status(), 'no change fund said').toBe(400);
    expect((await save({ ...good, pieces: { 75: 1 } })).status(), 'no such note').toBe(400);
    expect((await save({ ...good, pieces: { 100: 1.5 } })).status(), 'half a note').toBe(400);
    expect((await save({ ...good, pieces: {} })).status(), 'nothing entered').toBe(400);
  });

  test('the server does the adding, against the cash the till took, to the centavo', async () => {
    const before = await dayOf();
    const { amount } = await paidInCash();
    const after = await dayOf();
    expect(after.expected.cash, 'a cash payment is expected in the drawer').toBeCloseTo(before.expected.cash + amount, 2);
    expect(after.expected.receipts).toBe(before.expected.receipts + 1);

    const fund = 1000;
    const should = fund + after.expected.cash;
    // `counted` is not ours to claim: the total on the record is what the pieces add up to.
    const res = await save({
      changeFund: fund, ...piecesFor(should), counted: 1, note: after.current ? 'Counted again by the spec.' : '',
    });
    expect(res.status(), await res.text()).toBe(201);
    const { current, takenAfter } = (await res.json()).data;
    expect(current.counted).toBeCloseTo(should, 2);
    expect(current.outcome).toBe('balanced');
    expect(current.difference).toBe(0);
    expect(takenAfter).toBe(0);
  });

  test('a drawer that does not balance needs a note, and the Admin is told', async () => {
    const day = await dayOf();
    const fund = 500;
    const should = fund + day.expected.cash;
    const short = piecesFor(should - 50);

    const refused = await save({ changeFund: fund, ...short });
    expect(refused.status(), 'short, and nothing said about it').toBe(400);

    const res = await save({ changeFund: fund, ...short, note: 'Short by the amount a patient was handed back in error.' });
    expect(res.status(), await res.text()).toBe(201);
    const { current } = (await res.json()).data;
    expect(current.outcome).toBe('short');
    expect(current.difference).toBe(-50);

    const bell = (await (await ctx.get(`${API}/notifications`, { headers: auth(clinicAdmin) })).json()).data;
    const items = bell.notifications || bell.items || bell;
    expect(items.some((n) => /^Drawer short by/.test(n.title)), 'the Admin hears about it').toBe(true);

    const activity = (await (await ctx.get(`${API}/admin/activity`, { headers: auth(clinicAdmin) })).json()).data;
    const entry = (activity.entries || activity.items).find((e) => /^cash\.day_(re)?counted$/.test(e.action));
    expect(entry.description).toMatch(/50\.00 short/);
  });

  test('a recount needs a reason, and the first count stays on record', async () => {
    const before = await dayOf();
    const fund = 500;
    const should = fund + before.expected.cash;

    if (!before.current) {
      const first = await save({ changeFund: fund, ...piecesFor(should) });
      expect(first.status(), await first.text()).toBe(201);
    }
    const counted = await dayOf();
    const refused = await save({ changeFund: fund, ...piecesFor(should) });
    expect(refused.status(), 'already counted, and no reason given').toBe(400);
    expect((await refused.json()).message).toMatch(/why it is being counted again/i);

    const again = await save({ changeFund: fund, ...piecesFor(should), note: 'Found the missing notes behind the tray.' });
    expect(again.status(), await again.text()).toBe(201);
    const { current, replaced } = (await again.json()).data;
    expect(current.outcome).toBe('balanced');
    expect(replaced[0].id, 'what it replaced is still there').toBe(counted.current.id);
    expect(replaced.length).toBe(counted.replaced.length + 1);

    const list = (await (await ctx.get(`${API}/cash-counts`, { headers: auth(clinicAdmin), params: { startDate: today(), endDate: today() } })).json()).data;
    expect(list.days[0].recounts).toBeGreaterThanOrEqual(1);
    expect(list.days[0].count.outcome).toBe('balanced');
  });

  test('a payment taken after the count does not change the count; it is named beside it', async () => {
    const before = await dayOf();
    const fund = 500;
    const should = fund + before.expected.cash;
    const res = await save({ changeFund: fund, ...piecesFor(should), note: before.current ? 'Counted again by the spec.' : '' });
    expect(res.status(), await res.text()).toBe(201);
    const counted = (await res.json()).data.current;

    const { amount } = await paidInCash();
    const after = await dayOf();
    expect(after.current.counted, 'the count stands').toBe(counted.counted);
    expect(after.current.difference, 'measured against what the till said then').toBe(0);
    expect(after.takenAfter).toBeCloseTo(amount, 2);

    const list = (await (await ctx.get(`${API}/cash-counts`, { headers: auth(clinicAdmin), params: { startDate: today(), endDate: today() } })).json()).data;
    expect(list.days[0].takenAfter).toBeCloseTo(amount, 2);
  });

  test('the Cash Count screen states the difference as it is counted, and will not save it unexplained', async ({ page }) => {
    await signInTo(page, CASHIER, 'Cash Count');
    await expect(page.getByRole('heading', { name: 'Cash Count', level: 1 })).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('cash-count-expected')).toContainText('Cash taken', { timeout: 20000 });

    const countAgain = page.getByRole('button', { name: 'Count again' });
    const form = page.getByTestId('cash-count-form');
    await expect(countAgain.or(form).first()).toBeVisible({ timeout: 20000 });
    if (await countAgain.isVisible()) await countAgain.click();
    const recount = await page.getByRole('button', { name: 'Keep the first count' }).isVisible();

    const { expected } = await dayOf();
    const should = 1000 + expected.cash;
    const short = piecesFor(should - 20);
    await page.locator('#cash-change-fund').fill('1000');
    await page.locator('#cash-piece-1000').fill(String(short.pieces[1000]));
    await page.locator('#cash-piece-1').fill(String(short.pieces[1]));
    if (short.loose) await page.locator('#cash-loose').fill(String(short.loose));

    const difference = page.getByTestId('cash-count-difference');
    await expect(difference).toHaveAttribute('data-outcome', 'short');
    await expect(difference).toContainText('20.00 short');
    const saveButton = page.getByRole('button', { name: 'Save count' });
    await expect(saveButton, 'short, and nothing said about it').toBeDisabled();
    await expect(page.getByTestId('cash-count-needs-note')).toBeVisible();

    await page.locator('#cash-note').fill('Twenty pesos short after the change for the last patient.');
    await saveButton.click();

    const result = page.getByTestId('cash-count-result');
    await expect(result).toHaveAttribute('data-outcome', 'short', { timeout: 15000 });
    await expect(result).toContainText('20.00 short');
    if (recount) await expect(page.getByTestId('cash-count-replaced')).toBeVisible();

    // It prints as a document, not as this screen.
    await page.emulateMedia({ media: 'print' });
    const sheet = page.getByTestId('report-document');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Cash Count');
    await expect(sheet).toContainText('20.00 short');
    await page.emulateMedia({ media: 'screen' });
  });

  /** Counting began before the days these specs leave uncounted. */
  async function countingBeganLastWeek() {
    const date = daysAgo(6);
    const earlier = await dayOf(date);
    const res = await save({
      date, changeFund: 0, ...piecesFor(earlier.expected.cash), note: earlier.current ? 'Counted again by the spec.' : '',
    });
    expect(res.status(), await res.text()).toBe(201);
  }

  test('an Admin sees each day on Cashier Monitoring, and a day never counted says so', async ({ page }) => {
    await countingBeganLastWeek();
    const { payment } = await paidInCash();
    backdatePayment(payment.id, 2);
    const uncounted = daysAgo(2);
    const status = (await (await ctx.get(`${API}/cash-counts/status`, { headers: auth(desk) })).json()).data;

    await signInTo(page, 'clinicadmin@enlogada.com', 'Cashier Monitoring');
    const panel = page.getByTestId('closed-days');
    await expect(panel).toBeVisible({ timeout: 20000 });
    const row = panel.locator(`[data-testid="closed-day"][data-date="${uncounted}"]`);
    if (status.uncounted.includes(uncounted)) {
      await expect(row).toHaveAttribute('data-outcome', 'not-counted', { timeout: 15000 });
      await expect(row).toContainText('Not counted');
    } else {
      await expect(row).toBeVisible({ timeout: 15000 });
    }
    await expect(page.getByRole('button', { name: 'Save count' }), 'an Admin reads and does not count').toHaveCount(0);
  });

  test('Today tells whoever closes about a drawer left uncounted, and its button opens that day', async ({ page }) => {
    await countingBeganLastWeek();
    const { payment } = await paidInCash();
    backdatePayment(payment.id, 3);
    const day = daysAgo(3);
    const status = (await (await ctx.get(`${API}/cash-counts/status`, { headers: auth(desk) })).json()).data;
    expect(status.uncounted, `${day} took cash and was not counted`).toContain(day);

    await signIn(page, CASHIER);
    const need = page.locator('[data-need="cash-count"]');
    await expect(need).toBeVisible({ timeout: 20000 });
    await need.getByRole('button', { name: 'Count it' }).click();
    await expect(page.getByRole('heading', { name: 'Cash Count', level: 1 })).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#cash-count-date')).toHaveValue(status.uncounted[0], { timeout: 15000 });
    await openScreen(page, 'Today');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
