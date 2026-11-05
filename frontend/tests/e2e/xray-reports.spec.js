// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, signInTo } from './helpers/auth.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { reportPart } from './helpers/reportFile.js';
import { runScript } from './helpers/backendScript.js';
import { todayStr } from './helpers/dates.js';
import { openPortalTab } from './helpers/portal.js';

/**
 * X-ray reports here again. [1.143.0]
 *
 * From [1.129.0] the X-ray department gave its results through its own system: nothing was
 * uploaded, released or emailed here for an X-ray, and its worklist marked an exam DONE instead.
 * Steven asked for X-ray report uploading back, so an X-ray is attached, released and sent like a
 * laboratory or ultrasound report, and it finishes the same way: by its report, not by a status.
 *
 * The exams marked done meanwhile stay as they were: Done, with no report to open, send or amend.
 * Nothing in the API makes one any more, so the last test makes one with `e2eMarkExamDone.js`.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('X-ray: reported here, like every department', () => {
  let ctx;
  let reception, cashier, xray, lab, admin, client;
  let xrayTest, labTest;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };

  /** A paid walk-in carrying `testIds`, so its tests are on their departments' worklists. */
  const paidVisit = async (testIds, patientId = null) => {
    let person = null;
    if (!patientId) {
      person = fixturePerson();
      patientId = (await (await ctx.post(`${API}/patients`, {
        headers: auth(reception),
        data: {
          patientTypeId: await patientTypeId(ctx, API, reception, 'Self Pay'),
          ...person, birthdate: '1982-08-08', sex: 'Male', contactNumber: FIXTURE_CONTACT,
        },
      })).json()).data.patient.id;
    }
    const created = await ctx.post(`${API}/visits`, {
      headers: auth(reception), data: { patientId, visitType: 'Walk in', confirmRepeatTests: true, notes: 'xray spec', testIds },
    });
    expect(created.status(), await created.text()).toBe(201);
    const visit = (await created.json()).data.visit;
    await payAndReleaseWalkIn(ctx, API, visit.id, cashier);
    const lines = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json()).data.visitTests;
    const lineFor = (testId) => lines.find((l) => l.test_id === testId).id;
    return { person, visit, lineFor };
  };

  const markDone = (token, visitTestId) => ctx.patch(`${API}/results/test-status/${visitTestId}`, {
    headers: auth(token), data: { status: 'Completed' },
  });
  const attachAndRelease = async (token, visitTestId) => {
    const upload = await ctx.post(`${API}/results/${visitTestId}`, { headers: auth(token), multipart: { file: reportPart('xray') } });
    expect(upload.status(), await upload.text()).toBeLessThan(300);
    const release = await ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(token) });
    expect(release.status(), await release.text()).toBe(200);
  };
  const visitStatus = async (visitId) =>
    (await (await ctx.get(`${API}/visits/${visitId}`, { headers: auth(reception) })).json()).data.visit.status;

  /** X-ray's figures for today: the operations report, Today's turnaround table, and Staff Workload. */
  const xrayFigures = async () => {
    const get = async (path, key) => {
      const res = await ctx.get(`${API}/reports/${path}`, {
        headers: auth(admin), params: { startDate: todayStr(), endDate: todayStr() },
      });
      expect(res.status(), path).toBe(200);
      return (await res.json()).data[key];
    };
    const ops = await get('operations', 'report');
    const analytics = await get('analytics', 'report');
    const workload = await get('staff-workload', 'workload');
    const xr = (rows) => (rows || []).find((r) => r.category_name === 'Xray') || {};
    return {
      released: Number(xr(ops.diagnostics?.byCategory).released || 0),
      turnaround: Number(xr(analytics.turnaroundSla).released || 0),
      workload: (workload.diagnosticWorkload || [])
        .filter((r) => r.category_name === 'Xray')
        .reduce((sum, r) => sum + Number(r.result_count), 0),
    };
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [reception, cashier, xray, lab, admin, client] = await Promise.all([
      'receptionist@enlogada.com', 'cashier@enlogada.com', 'xray@enlogada.com',
      'lab@enlogada.com', 'admin@enlogada.com', 'client@enlogada.com',
    ].map(login));
    const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
    xrayTest = tests.find((t) => t.is_active && t.category_name === 'Xray' && Number(t.price) > 0);
    labTest = tests.find((t) => t.is_active && t.category_name === 'Laboratory' && Number(t.price) > 0);
    expect(xrayTest, 'need an active X-ray service').toBeTruthy();
    expect(labTest, 'need an active laboratory service').toBeTruthy();
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('an X-ray report is attached and released, and finishes the visit', async ({ page }) => {
    const { person, visit, lineFor } = await paidVisit([xrayTest.id]);
    const line = lineFor(xrayTest.id);

    // Finished by its report, as every department is: not by setting a status.
    const byHand = await markDone(xray, line);
    expect(byHand.status(), 'Completed by hand on an X-ray').toBe(403);
    expect((await byHand.json()).message).toMatch(/releasing their report/i);

    const before = await xrayFigures();
    await attachAndRelease(xray, line);
    expect(await visitStatus(visit.id), 'its only test released, the visit is over').toBe('Completed');

    // Emailing is offered as for any report; this patient simply has no address to send to.
    const email = await ctx.post(`${API}/results/${line}/email`, { headers: auth(xray) });
    expect((await email.json()).message || '').not.toMatch(/own system/i);

    // Counted as the department's work for today, in each report that counts it.
    const after = await xrayFigures();
    expect(after.released, 'Departments: X-ray released today').toBe(before.released + 1);
    expect(after.turnaround, "Today's department table").toBe(before.turnaround + 1);
    expect(after.workload, 'Staff Workload').toBe(before.workload + 1);

    // On the department's History as a report, with the delivery state every report carries.
    const history = (await (await ctx.get(`${API}/results/released/Xray`, {
      headers: auth(xray), params: { days: 0, limit: 50 },
    })).json()).data.released;
    const row = history.find((r) => r.visit_test_id === line);
    expect(row, 'a released X-ray is on X-ray History').toBeTruthy();
    expect(row.result_id).toBeTruthy();
    expect(row.performed_at).toBeNull();
    expect(row).toHaveProperty('emailed_at');

    // Finished, so it is on the patient's file at the front desk, as Released.
    await signInTo(page, 'receptionist@enlogada.com', 'Patient Records');
    await page.getByRole('searchbox', { name: 'Search patient records' }).fill(person.fullName);
    await page.getByRole('button', { name: 'Apply' }).click();
    const patientRow = page.locator(`[data-testid="patient-row"][data-patient-id="${visit.patient_id}"]`);
    await expect(patientRow).toBeVisible({ timeout: 20000 });
    await patientRow.getByTestId('patient-records-toggle').click();
    const file = page.getByTestId('patient-file');
    await expect(file.getByTestId('patient-file-test')).toHaveAttribute('data-state', 'released');
  });

  test('a visit with X-ray and laboratory work ends when both reports are released', async () => {
    const { visit, lineFor } = await paidVisit([xrayTest.id, labTest.id]);
    await attachAndRelease(xray, lineFor(xrayTest.id));
    expect(await visitStatus(visit.id), 'the laboratory test is still out').not.toBe('Completed');

    await attachAndRelease(lab, lineFor(labTest.id));
    expect(await visitStatus(visit.id)).toBe('Completed');
  });

  test('a department that issues reports is finished by its report, not by a status', async () => {
    const { lineFor } = await paidVisit([labTest.id]);
    const res = await markDone(lab, lineFor(labTest.id));
    expect(res.status(), 'Completed by hand on a laboratory test').toBe(403);
    expect((await res.json()).message).toMatch(/releasing their report/i);
  });

  test('the X-ray worklist attaches a report, and the patient opens it in the portal', async ({ page }) => {
    // The seeded client's own profile, so the portal half can be checked on the same visit.
    const profile = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(client) })).json()).data.patients[0];
    const { lineFor } = await paidVisit([xrayTest.id], profile.id);
    const line = lineFor(xrayTest.id);
    const fullName = `${profile.first_name} ${profile.last_name}`;

    await signInTo(page, 'xray@enlogada.com', 'X-Ray Worklist');
    await page.getByPlaceholder('Search patient, test, queue...').fill(profile.last_name);
    const row = page.locator('tbody tr', { hasText: fullName }).filter({ hasText: xrayTest.name }).first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await expect(row.getByRole('button', { name: 'Attach Report' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Mark done' })).toHaveCount(0);

    await attachAndRelease(xray, line);

    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await signIn(page, 'client@enlogada.com');
    await openPortalTab(page, 'results');
    const item = page.locator('li', { hasText: `REQ-${line}` });
    await expect(item).toBeVisible({ timeout: 20000 });
    await expect(item.getByRole('button', { name: 'View report' })).toBeVisible();
    await expect(item).not.toContainText(/given by the X-Ray department/i);
  });

  // [1.129.0]-[1.143.0] An exam marked done while X-ray gave results through its own system has
  // no report. It must still read Done, and offer nothing that needs one.
  test('an X-ray marked done before reports came back still reads Done, with nothing to send', async ({ page }) => {
    // A patient of their own, with an account, so the portal half can be read too. The script
    // only touches a fixture's test, so the profile carries the fixture number.
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const own = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, token, 'Self Pay'),
        firstName: person.firstName, lastName: person.lastName, birthdate: '1979-05-14', sex: 'Female',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, emergencyContact: '',
      },
    })).json()).data.patient;
    const { visit, lineFor } = await paidVisit([xrayTest.id], own.id);
    const line = lineFor(xrayTest.id);
    runScript('e2eMarkExamDone.js', [`--visit-test=${line}`], 'mark exam done');
    expect(await visitStatus(visit.id)).toBe('Completed');

    // History lists it as done, outside the "Not sent" pile.
    const released = async (params) => (await (await ctx.get(`${API}/results/released/Xray`, {
      headers: auth(xray), params: { days: 0, limit: 200, search: person.lastName, ...params },
    })).json()).data.released;
    const row = (await released({})).find((r) => r.visit_test_id === line);
    expect(row?.result_id ?? null).toBeNull();
    expect(row?.performed_at).toBeTruthy();
    expect((await released({ delivery: 'unsent' })).map((r) => r.visit_test_id)).not.toContain(line);

    await signInTo(page, 'xray@enlogada.com', 'X-Ray History');
    await page.getByPlaceholder('Search patient, test, queue...').fill(person.fullName);
    const historyRow = page.locator('tbody tr', { hasText: person.fullName }).first();
    await expect(historyRow).toBeVisible({ timeout: 20000 });
    await expect(historyRow).toContainText('Marked done');
    await expect(historyRow).toContainText('No report here');
    await expect(historyRow.getByRole('button', { name: /View Report|Email|Send again|Edit/ })).toHaveCount(0);

    // Patient Records' final record keeps it, as Done.
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await signInTo(page, 'clinicadmin@enlogada.com', 'Patient Records');
    await page.getByLabel('Search patient records').fill(person.fullName);
    await page.getByRole('button', { name: 'Apply' }).click();
    const patientRow = page.locator(`[data-testid="patient-row"][data-patient-id="${visit.patient_id}"]`);
    await expect(patientRow).toContainText('1 X-ray done', { timeout: 20000 });
    await patientRow.getByTestId('patient-records-toggle').click();
    await expect(page.getByTestId('patient-results').locator('[data-final="done"]'))
      .toContainText('Result given by the X-Ray department');

    // And the patient is told where that result came from, with no report to open.
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await signIn(page, email, PASSWORD);
    await openPortalTab(page, 'results');
    const item = page.locator('li', { hasText: `REQ-${line}` });
    await expect(item).toBeVisible({ timeout: 20000 });
    await expect(item).toContainText(/Done\. Your X-Ray result is given by the X-Ray department/i);
    await expect(item.getByRole('button', { name: 'View report' })).toHaveCount(0);
  });
});
