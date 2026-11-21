// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';

/**
 * A department's worklist shows its own patients, however it was reached. [1.173.0]
 *
 * Found walking the seeded screens: Laboratory Worklist, then Laboratory History, then Ultrasound
 * Worklist showed the laboratory's patients under "Ultrasound Worklist". Leaving a History changes
 * the mode in the same render and the department one render later, so a request for the OLD
 * department's worklist went out first, and when it answered last it stayed on screen. The
 * laboratory's answer is held back here so it always answers last.
 */

const API = (process.env.E2E_API_URL || 'http://localhost:5000') + '/api';
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

test('Laboratory History, then the Ultrasound Worklist: only ultrasound patients, even when the laboratory answers last', async ({ page }) => {
  test.setTimeout(90000);
  const ctx = await request.newContext();
  const login = async (e) => (await (await ctx.post(`${API}/auth/login`, { data: { email: e, password: PASSWORD } })).json()).data.token;
  const [desk, till] = await Promise.all(['receptionist@enlogada.com', 'multirole@enlogada.com'].map(login));
  const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
  const pick = (cat) => tests.find((t) => t.category_name === cat && t.is_active);

  // One paid patient on each worklist.
  const people = {};
  for (const cat of ['Laboratory', 'Ultrasound']) {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk), data: { patientTypeId: await patientTypeId(ctx, API, desk), ...person, birthdate: '1985-05-05', sex: 'Female', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const visit = (await (await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', testIds: [pick(cat).id] } })).json()).data.visit;
    const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth(till) })).json()).data.bill;
    await ctx.post(`${API}/payments`, { headers: auth(till), data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: Number(bill.totalAmount) } });
    people[cat] = person;
  }
  await ctx.dispose();

  // Each row names its department under the test; a busy worklist pages, so the department, not a
  // patient's name, is what is checked.
  const departmentCells = page.locator('main table tbody td').getByText(/^(Laboratory|Ultrasound|Xray)$/);
  await signInTo(page, 'admin@enlogada.com', 'Laboratory Worklist');
  await expect(departmentCells.first()).toHaveText('Laboratory', { timeout: 20000 });
  await page.getByRole('button', { name: 'Laboratory History', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Laboratory History', level: 1 })).toBeVisible();

  // From here on the laboratory's worklist answers late.
  await page.route('**/api/results/pending/Laboratory', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.getByRole('button', { name: 'Ultrasound Worklist', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Ultrasound Worklist', level: 1 })).toBeVisible();
  await expect(departmentCells.first()).toHaveText('Ultrasound', { timeout: 20000 });
  await page.waitForTimeout(2500); // past the late laboratory answer
  const shown = await departmentCells.allTextContents();
  expect(shown.length, 'the ultrasound worklist has its patients').toBeGreaterThan(0);
  expect(shown.filter((d) => d !== 'Ultrasound'), 'no other department on the ultrasound worklist').toEqual([]);
});
