// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';
import { appointmentForm, removeUnpaid } from './helpers/booking.js';
import { registerClient } from './helpers/accounts.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { patientTypeId } from './helpers/patients.js';
import { nthWorkingDay } from './helpers/dates.js';
import { runScript } from './helpers/backendScript.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';

/**
 * The waiting-room "Now serving" screen, and the Call button that drives it. [1.149.0]
 *
 * The screen is public and carries ticket numbers only; a call asks for the permission of the screen
 * it comes from, and is refused where it could send the wrong person.
 */

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

test.describe('Now serving', () => {
  /** @type {import('playwright/test').APIRequestContext} */
  let ctx;
  let reception, desk, lab, ultrasound;
  let labTest;
  const unpaid = [];

  const login = async (email) => (await (await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).json()).data.token;

  /** A walk-in in today's queue, for a new fixture patient, with one Laboratory test. */
  async function walkIn({ pay = false } = {}) {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: await patientTypeId(ctx, API, reception), firstName: person.firstName, lastName: person.lastName,
        birthdate: '1990-05-14', sex: 'Female', address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, emergencyContact: '',
      },
    })).json()).data.patient;
    const res = await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.id, visitType: 'Walk in', notes: '', testIds: [labTest.id] },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { visit } = (await res.json()).data;
    if (pay) {
      const paid = await payAndReleaseWalkIn(ctx, API, visit.id, desk);
      expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    } else {
      unpaid.push(visit.id);
    }
    return { visit, person, name: `${person.firstName} ${person.lastName}` };
  }

  const call = (token, visitId, station) => ctx.post(`${API}/queue/calls`, { headers: auth(token), data: { visitId, station } });

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [reception, desk, lab, ultrasound] = await Promise.all([
      'receptionist@enlogada.com', 'multirole@enlogada.com', 'lab@enlogada.com', 'ultrasound@enlogada.com',
    ].map(login));
    labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests.find((t) => t.category_name === 'Laboratory');
  });

  test.afterAll(async () => {
    for (const id of unpaid) {
      try { removeUnpaid(id, { visit: true }); } catch { /* already gone */ }
    }
    await ctx?.dispose();
  });

  test('the screen needs no sign-in, and carries a ticket, a station and a time, never a name', async () => {
    const { visit, person } = await walkIn();
    expect((await call(desk, visit.id, 'Cashier')).status()).toBe(201);

    const res = await ctx.get(`${API}/queue/now-serving`);
    expect(res.status(), 'no token sent').toBe(200);
    const text = await res.text();
    expect(text).not.toContain(person.firstName);
    expect(text).not.toContain(person.lastName);
    const { stations } = JSON.parse(text).data;
    expect(stations.map((s) => s.station)).toEqual(['Front Desk', 'Cashier', 'Laboratory', 'Ultrasound', 'Xray']);
    const cashier = stations.find((s) => s.station === 'Cashier');
    expect(cashier.ticket).toBe(visit.queue_number);
    expect(Object.keys(cashier).sort()).toEqual(['calledAt', 'id', 'label', 'station', 'ticket']);
  });

  test('a call answers to the screen it comes from', async () => {
    const { visit } = await walkIn();
    expect((await call(lab, visit.id, 'Cashier')).status(), 'a department does not take money').toBe(403);
    expect((await call(lab, visit.id, 'Front Desk')).status(), 'nor work the desk').toBe(403);
    expect((await call(reception, visit.id, 'Laboratory')).status(), 'the desk does not do the exam').toBe(403);
    expect((await call(reception, visit.id, 'Cashier')).status(), 'nor take money').toBe(403);
    expect((await call(reception, visit.id, 'Front Desk')).status()).toBe(201);
    expect((await ctx.post(`${API}/queue/calls`, { data: { visitId: visit.id, station: 'Cashier' } })).status(), 'no account').toBe(401);

    const person = fixturePerson();
    const { token } = await registerClient(ctx, { ...person, email: fixtureEmail(person), password: PASSWORD });
    expect((await call(token, visit.id, 'Front Desk')).status(), 'a patient is staff at no station').toBe(403);

    expect((await call(reception, visit.id, 'Pharmacy')).status(), 'no such station').toBe(400);
    expect((await call(reception, 999999999, 'Front Desk')).status(), 'no such visit').toBe(404);
  });

  test('a department calls only what has reached it, in its own department', async () => {
    const waiting = await walkIn();
    const early = await call(lab, waiting.visit.id, 'Laboratory');
    expect(early.status(), 'unpaid, so not released to the department').toBe(409);
    expect((await early.json()).message).toMatch(/nothing waiting at Laboratory/i);

    const { visit } = await walkIn({ pay: true });
    expect((await call(ultrasound, visit.id, 'Laboratory')).status(), 'another department\'s staff').toBe(403);
    expect((await call(lab, visit.id, 'Ultrasound')).status(), 'nor the other way round').toBe(403);
    expect((await call(lab, visit.id, 'Laboratory')).status()).toBe(201);
    expect((await call(desk, visit.id, 'Cashier')).status(), 'already paid').toBe(409);

    const row = (await (await ctx.get(`${API}/results/pending/Laboratory`, { headers: auth(lab) })).json()).data.pending
      .find((p) => p.visit_id === visit.id);
    expect(row.last_called_at, 'the worklist says it was called').toBeTruthy();
  });

  test('a ticket with no number, or from an earlier day, cannot be called', async () => {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1988-02-02', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const date = nthWorkingDay(215);
    const slot = ((await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(reception) })).json()).data.slots || []).find((s) => s.available);
    const booked = await ctx.post(`${API}/appointments`, {
      headers: auth(token),
      multipart: appointmentForm({ patientId: patient.id, scheduledDate: date, scheduledTime: slot.time, testIds: [labTest.id] }),
    });
    expect(booked.status(), await booked.text()).toBe(201);
    const { appointment } = (await booked.json()).data;
    const noTicket = await call(reception, appointment.patient_visit_id, 'Front Desk');
    expect(noTicket.status(), 'a booking has no ticket until it is checked in').toBe(409);
    expect((await noTicket.json()).message).toMatch(/no ticket yet/i);
    removeUnpaid(appointment.id);

    const { visit } = await walkIn({ pay: true });
    runScript('e2eBackdateVisit.js', [`--visit=${visit.id}`, '--days=1'], 'moving the visit to yesterday');
    try {
      const old = await call(lab, visit.id, 'Laboratory');
      expect(old.status(), "tickets restart each day: this number may be someone else's today").toBe(409);
      expect((await old.json()).message).toMatch(/earlier day/i);
    } finally {
      runScript('e2eBackdateVisit.js', [`--visit=${visit.id}`, '--days=-1'], 'moving the visit back');
    }
  });

  test('the TV shows a call as it is made, without being touched, and lights its tile', async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${BASE}/?display=queue`);
    await expect(page.getByRole('heading', { name: 'Now serving', level: 1 })).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('now-serving-tile')).toHaveCount(5);
    await expect(page.getByTestId('now-serving-sound')).toHaveText('Turn on sound');
    await expect(page.locator('[data-station="Laboratory"][data-lit="true"]')).toHaveCount(0);

    const { visit, name } = await walkIn({ pay: true });
    const answer = await call(lab, visit.id, 'Laboratory');
    expect((await answer.json()).data.call.displayOpen, 'the screen has asked lately').toBe(true);

    const tile = page.locator('[data-testid="now-serving-tile"][data-station="Laboratory"]');
    await expect(tile.getByTestId('now-serving-ticket')).toHaveText(visit.queue_number, { timeout: 15000 });
    await expect(tile).toHaveAttribute('data-lit', 'true');
    await expect(page.locator('body')).not.toContainText(name);

    await page.getByTestId('now-serving-sound').click();
    await expect(page.getByTestId('now-serving-sound')).toHaveText('Sound on');
    await page.close();
  });

  test('a phone reads the TV page without scrolling sideways', async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
    await page.goto(`${BASE}/?display=queue`);
    await expect(page.getByTestId('now-serving-tile').first()).toBeVisible({ timeout: 20000 });
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    await page.close();
  });

  test('the Desk calls from its queue, and says so, and offers the screen', async ({ page }) => {
    const { visit, name } = await walkIn();
    await signInTo(page, 'receptionist@enlogada.com', 'Desk');
    // By name: on a long run this ticket is not on the queue's first page.
    await page.getByRole('searchbox', { name: "Who's here?" }).fill(name);
    const row = page.getByRole('row').filter({ hasText: name });
    await row.getByTestId('call-ticket').click();
    await expect(page.getByText(`Called ticket ${visit.queue_number} to Front Desk`).first()).toBeVisible({ timeout: 15000 });
    await expect(row.getByTestId('call-ticket')).toHaveText('Call again');
    await expect(row.getByTestId('call-ticket-last')).toHaveText('Called just now');
    await expect(page.getByRole('button', { name: 'Waiting-room screen' })).toHaveCount(1);
  });

  // On an account made here: on the dev database the seeded cashier may also hold Receptionist.
  test('a Cashier reading the Desk is offered neither its Call nor the screen, and the API agrees', async ({ page }) => {
    const { visit, name } = await walkIn();
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const admin = await login('clinicadmin@enlogada.com');
    const made = await ctx.post(`${API}/admin/staff`, {
      headers: auth(admin),
      data: { firstName: person.firstName, lastName: person.lastName, email, password: PASSWORD, roles: ['Cashier'], contactNumber: FIXTURE_CONTACT },
    });
    expect(made.status(), await made.text()).toBe(201);

    const token = await login(email);
    expect((await call(token, visit.id, 'Front Desk')).status(), 'the Front Desk asks for visits:create, which a Cashier does not hold').toBe(403);
    expect((await call(token, visit.id, 'Cashier')).status(), 'the till is theirs').toBe(201);

    await signInTo(page, email, 'Desk', PASSWORD);
    const row = page.getByRole('row').filter({ hasText: name });
    await page.getByPlaceholder('Search patient name or Queue #...').fill(name);
    await expect(row).toBeVisible({ timeout: 20000 });
    await expect(row.getByTestId('call-ticket')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Waiting-room screen' })).toHaveCount(0);
  });

  test('the Billing Queue calls beside the row, and picking the row still works', async ({ page }) => {
    const { visit, name } = await walkIn();
    await signInTo(page, 'multirole@enlogada.com', 'Billing Queue');
    const row = page.getByRole('button', { name: new RegExp(name) });
    await expect(row).toBeVisible({ timeout: 20000 });
    const call_ = page.getByRole('button', { name: `Call: ticket ${visit.queue_number} to Cashier` });
    await call_.click();
    await expect(page.getByText(`Called ticket ${visit.queue_number} to Cashier`).first()).toBeVisible({ timeout: 15000 });
    await expect(row, 'calling does not pick the row for payment').toHaveAttribute('aria-pressed', 'false');
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
  });

  test('a worklist calls from today\'s tickets, and offers nothing for an earlier day\'s', async ({ page }) => {
    const today = await walkIn({ pay: true });
    const earlier = await walkIn({ pay: true });
    runScript('e2eBackdateVisit.js', [`--visit=${earlier.visit.id}`, '--days=1'], 'moving the visit to yesterday');
    try {
      await signInTo(page, 'lab@enlogada.com', 'Laboratory Worklist');
      const search = page.getByPlaceholder('Search patient, test, queue...');
      await search.fill(today.name);
      const row = page.getByRole('row').filter({ hasText: today.name });
      await row.getByTestId('call-ticket').click();
      await expect(page.getByText(`Called ticket ${today.visit.queue_number} to Laboratory`).first()).toBeVisible({ timeout: 15000 });
      await expect(row.getByTestId('call-ticket-last')).toHaveText('Called just now');

      await search.fill(earlier.name);
      const old = page.getByRole('row').filter({ hasText: earlier.name });
      await expect(old).toBeVisible({ timeout: 15000 });
      await expect(old.getByTestId('call-ticket')).toHaveCount(0);
    } finally {
      runScript('e2eBackdateVisit.js', [`--visit=${earlier.visit.id}`, '--days=-1'], 'moving the visit back');
    }
  });
});
