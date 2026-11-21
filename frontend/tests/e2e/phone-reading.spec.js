// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInOnPhone } from './helpers/auth.js';
import { openBooking, openPortalTab } from './helpers/portal.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { pdfReport } from './helpers/reportFile.js';
import { nthWorkingDay } from './helpers/dates.js';

/**
 * What a patient reads on a phone, found walking the portal at 393 px. [1.173.0]
 *
 * Their own report's header cut their name to "Elena Cabre…"; the booking's "Before your visit"
 * sat below the pinned Next button, so it was passed before it was read; and Home's "Add a profile"
 * opened only the tab, where the patient had to find a second "Add a profile".
 */

const API = (process.env.E2E_API_URL || 'http://localhost:5000') + '/api';
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });
test.use({ viewport: { width: 393, height: 820 } });

test('a released report on a phone shows the patient\'s whole name, birthday and type, nothing cut short', async ({ page }) => {
  test.setTimeout(120000);
  const ctx = await request.newContext();
  const person = { ...fixturePerson(), lastName: 'Villanueva-Dela Cruz' };
  const email = fixtureEmail(person);
  const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
  const login = async (e) => (await (await ctx.post(`${API}/auth/login`, { data: { email: e, password: PASSWORD } })).json()).data.token;
  const [desk, lab] = await Promise.all(['receptionist@enlogada.com', 'lab@enlogada.com'].map(login));
  const patient = (await (await ctx.post(`${API}/patients`, {
    headers: auth(token),
    data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1990-09-30', sex: 'Female', contactNumber: FIXTURE_CONTACT },
  })).json()).data.patient;
  const labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests.find((t) => t.category_name === 'Laboratory' && t.is_active);
  const visit = (await (await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', testIds: [labTest.id] } })).json()).data.visit;
  await payAndReleaseWalkIn(ctx, API, visit.id);
  const vt = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(desk) })).json()).data.visitTests[0];
  expect((await ctx.post(`${API}/results/${vt.id}`, { headers: auth(lab), multipart: { file: { name: 'report.pdf', mimeType: 'application/pdf', buffer: pdfReport('phone') } } })).status()).toBe(201);
  expect((await ctx.post(`${API}/results/${vt.id}/release`, { headers: auth(lab) })).status()).toBe(200);
  await ctx.dispose();

  await signInOnPhone(page, email, PASSWORD);
  await openPortalTab(page, 'results');
  await page.getByRole('button', { name: /^View report/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`${person.firstName} ${person.lastName}`)).toBeVisible();
  const cut = await dialog.evaluate((d) => [...d.querySelectorAll('span')]
    .filter((e) => e.children.length === 0 && e.textContent.trim() && getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1)
    .map((e) => e.textContent.trim()));
  expect(cut, 'no value in the report header ends in "…"').toEqual([]);
});

test('the booking\'s "Before your visit" comes before the pinned Next button, not after it', async ({ page }) => {
  test.setTimeout(120000);
  const ctx = await request.newContext();
  const person = fixturePerson();
  const email = fixtureEmail(person);
  const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
  await ctx.post(`${API}/patients`, {
    headers: auth(token),
    data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1990-01-01', sex: 'Female', contactNumber: FIXTURE_CONTACT },
  });
  const prepared = (await (await ctx.get(`${API}/tests`)).json()).data.tests.find((t) => t.is_active && t.preparation);
  await ctx.dispose();
  test.skip(!prepared, 'no active test carries preparation');

  await signInOnPhone(page, email, PASSWORD);
  const dialog = await openBooking(page);
  await dialog.locator('#slotpicker-label').fill(nthWorkingDay(253));
  await dialog.getByPlaceholder('Filter tests…').fill(prepared.name);
  await dialog.getByRole('checkbox', { name: new RegExp(prepared.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().check();
  await dialog.getByPlaceholder('Filter tests…').fill('');
  const note = dialog.getByText('Before your visit');
  await expect(note).toBeVisible();
  // Scrolled to the end, as a patient reading down would be.
  await dialog.evaluate((d) => { const s = [d, ...d.querySelectorAll('*')].find((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight); if (s) s.scrollTop = s.scrollHeight; });
  const [n, next] = [await note.boundingBox(), await dialog.getByRole('button', { name: /Next: HMO/ }).last().boundingBox()];
  expect(n && next && n.y < next.y, 'the note is above Next').toBeTruthy();
});

test('Home\'s "Add a profile" opens the form itself', async ({ page }) => {
  const ctx = await request.newContext();
  const person = fixturePerson();
  const email = fixtureEmail(person);
  await registerClient(ctx, { ...person, email, password: PASSWORD });
  await ctx.dispose();
  await signInOnPhone(page, email, PASSWORD);
  await page.locator('[data-testid="portal-need"][data-need="no-profile"]').getByRole('button', { name: 'Add a profile' }).click();
  await expect(page.getByRole('dialog').getByText('Add a patient profile')).toBeVisible();
});
