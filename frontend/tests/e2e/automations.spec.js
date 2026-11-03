// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn, openScreen } from './helpers/auth.js';
import { openPortalTab } from './helpers/portal.js';
import { appointmentForm, removeUnpaid } from './helpers/booking.js';
import { registerClient } from './helpers/accounts.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { patientTypeId } from './helpers/patients.js';
import { nthWorkingDay } from './helpers/dates.js';
import { runScript } from './helpers/backendScript.js';
import { payAndReleaseWalkIn } from './helpers/ticketRelease.js';
import { reportPart } from './helpers/reportFile.js';

/**
 * What the server now does by itself, and what it tells the people who need to act. [1.148.0]
 *
 * Steven's "everything" from the list of work that only happened if somebody remembered:
 *   - three patient emails: results ready, a paid booking nobody came for, "how was your visit?"
 *     (when each is due is unit-tested in backend/tests/unit/patientMessageTiming.test.js; this
 *     checks the plan the server sends from, for real visits, and nothing is sent: the fixture's
 *     address is never mailed)
 *   - HMO claims a booking waits on, soonest deadline first, with the time left
 *   - a worklist test past its department's turnaround target
 *   - the nightly backup's status, for whoever reads the Activity Log
 * The retention pass and the backup itself are run by hand in the release's checks, not here:
 * one deletes old rows, the other writes the whole database to disk.
 */

const API = `${process.env.E2E_API_URL || 'http://localhost:5000'}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });

/** What a sweep would do now: the server's own plan, read through the backend script. */
const messagePlan = () => JSON.parse(runScript('sendPatientMessages.js', ['--json'], 'the patient email plan')
  .split('\n').find((line) => line.startsWith('[')) || '[]');
const planned = (kind, id) => messagePlan().find((m) => m.kind === kind && m.id === id);

/** Outside 21:00-07:00 an email that is due goes now; inside, it waits for the morning. */
const daytime = (from = 7) => {
  const h = new Date().getHours();
  return h >= from && h < 21;
};

test.describe('What the server does by itself', () => {
  /** @type {import('playwright/test').APIRequestContext} */
  let ctx;
  let desk, reception, clinicAdmin, lab;
  let labTest;
  let client;
  let day = 0;
  const unpaid = [];

  const login = async (email) => (await (await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).json()).data.token;

  /** A free slot on a day of this spec's own. */
  const nextSlot = async () => {
    const date = nthWorkingDay(205 + day++);
    const slot = ((await (await ctx.get(`${API}/appointments/availability?date=${date}`, { headers: auth(reception) })).json())
      .data.slots || []).find((s) => s.available);
    expect(slot, `a free slot on ${date}`).toBeTruthy();
    return { date, time: slot.time };
  };

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [desk, reception, clinicAdmin, lab] = await Promise.all([
      'multirole@enlogada.com', 'receptionist@enlogada.com', 'clinicadmin@enlogada.com', 'lab@enlogada.com',
    ].map(login));
    labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests.find((t) => t.category_name === 'Laboratory');

    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: {
        patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1987-03-11', sex: 'Female',
        address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT, emergencyContact: '',
      },
    })).json()).data.patient;
    client = { token, patient, email };
  });

  test.afterAll(async () => {
    for (const id of unpaid) {
      try { removeUnpaid(id); } catch { /* already gone */ }
    }
    await ctx?.dispose();
  });

  test('a paid booking nobody came for: owed an email the morning after, said on the portal, and moving it ends both', async ({ page }) => {
    const { date, time } = await nextSlot();
    const res = await ctx.post(`${API}/appointments`, {
      headers: auth(desk),
      data: {
        patientId: client.patient.id, scheduledDate: date, scheduledTime: time, testIds: [labTest.id],
        payment: { paymentMethod: 'Cash', amount: Number(labTest.price) },
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const appt = (await res.json()).data.appointment;
    expect(planned('missedBooking', appt.id), 'a booking still to come is owed nothing').toBeUndefined();

    runScript('e2eMoveBookingStart.js', [`--appointment=${appt.id}`, '--days-ago=1'], 'moving the booking to yesterday');
    const owed = planned('missedBooking', appt.id);
    expect(owed, "yesterday's paid booking is owed its email").toBeTruthy();
    expect(owed.to).toBe(client.email);
    // Due from 08:00 the morning after, never at night.
    expect(owed.action).toBe(daytime(8) ? 'send' : 'wait');

    await signIn(page, client.email, PASSWORD);
    await expect(page.locator(`[data-need="missed-${appt.id}"]`)).toContainText('Your payment still stands', { timeout: 20000 });
    await openPortalTab(page, 'appointments');
    await expect(page.getByTestId('booking-missed')).toBeVisible();

    const next = await nextSlot();
    const moved = await ctx.put(`${API}/appointments/${appt.id}/reschedule`, {
      headers: auth(client.token),
      data: { scheduledDate: next.date, scheduledTime: next.time, reason: 'Missed it, so a new time.' },
    });
    expect(moved.status(), await moved.text()).toBe(200);
    expect(planned('missedBooking', appt.id), 'moved, so nothing is owed').toBeUndefined();
    await page.reload();
    await openPortalTab(page, 'appointments');
    await expect(page.getByTestId('booking-missed')).toHaveCount(0);
  });

  test('a visit whose report is released: "results ready" is owed at once, to the account, and feedback the next morning', async () => {
    const visit = (await (await ctx.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: client.patient.id, visitType: 'Walk in', notes: '', testIds: [labTest.id] },
    })).json()).data.visit;
    await payAndReleaseWalkIn(ctx, API, visit.id);
    const visitTestId = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(reception) })).json())
      .data.visitTests[0].id;

    const saved = await ctx.post(`${API}/results/${visitTestId}`, {
      headers: auth(lab), multipart: { findings: 'See the attached report.', remarks: '', file: reportPart('cbc') },
    });
    expect(saved.status(), await saved.text()).toBe(201);
    expect(planned('resultsReady', visit.id), 'saved is not released: nothing to tell yet').toBeUndefined();

    expect((await ctx.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) })).status()).toBe(200);
    const ready = planned('resultsReady', visit.id);
    expect(ready, 'released, so the patient is owed "results ready"').toBeTruthy();
    expect(ready.to).toBe(client.email);
    expect(ready.action).toBe(daytime() ? 'send' : 'wait');

    const questions = (await (await ctx.get(`${API}/feedback/questions`, { headers: auth(client.token) })).json()).data.questions;
    const ask = planned('feedbackInvite', visit.id);
    if (questions.length) {
      expect(ask, 'and "how was your visit?"').toBeTruthy();
      expect(ask.action, 'the morning after, not the moment it finished').toBe('wait');
    } else {
      expect(ask, 'no questions switched on, nobody is asked').toBeUndefined();
    }
  });

  test('HMO claims a booking waits on come first, soonest deadline on top, with the time left', async ({ page }) => {
    const providerId = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(client.token) })).json()).data.providers[0].id;
    const { date, time } = await nextSlot();
    const res = await ctx.post(`${API}/appointments`, {
      headers: auth(client.token),
      multipart: appointmentForm(
        { patientId: client.patient.id, scheduledDate: date, scheduledTime: time, testIds: [labTest.id], hmo: { providerId } },
        { hmoCard: true }
      ),
    });
    expect(res.status(), await res.text()).toBe(201);
    const { appointment, hmoRequest } = (await res.json()).data;
    unpaid.push(appointment.id);

    const pending = (await (await ctx.get(`${API}/hmo/requests`, { headers: auth(clinicAdmin), params: { status: 'Pending' } })).json()).data.requests;
    const mine = pending.find((r) => r.id === hmoRequest.id);
    expect(mine.decide_by, 'decided by the booking\'s own start').toBeTruthy();
    expect(new Date(mine.decide_by).getTime()).toBe(new Date(appointment.held_until).getTime());
    expect(mine.minutes_to_decide).toBeGreaterThan(60);
    const timed = pending.filter((r) => r.minutes_to_decide !== null).map((r) => r.minutes_to_decide);
    expect(timed, 'soonest first').toEqual([...timed].sort((a, b) => a - b));
    const firstWithout = pending.findIndex((r) => r.minutes_to_decide === null);
    const lastWith = pending.map((r) => r.minutes_to_decide !== null).lastIndexOf(true);
    if (firstWithout !== -1) expect(lastWith, 'claims with a deadline before those without').toBeLessThan(firstWithout);

    await signIn(page, 'clinicadmin@enlogada.com', PASSWORD);
    await expect(page.locator('[data-need="hmo-decisions"]')).toContainText(/Soonest: .+, decide by .+ \(.+ left\)/, { timeout: 20000 });
    await openScreen(page, 'Service Requests');
    await expect(page.getByTestId('claim-decide-by').first()).toContainText(/left|time is up/, { timeout: 20000 });
  });

  test('a worklist test carries when it reached the department, and is flagged past the target the clinic set', async ({ page }) => {
    const pending = (await (await ctx.get(`${API}/results/pending/Laboratory`, { headers: auth(lab) })).json()).data.pending;
    for (const row of pending) {
      expect(row.ready_at, 'paid and here').toBeTruthy();
      expect(row).toHaveProperty('target_minutes');
    }
    const target = pending[0]?.target_minutes ?? null;
    const now = Date.now();
    const late = target === null ? [] : pending.filter((r) => Math.floor((now - new Date(r.ready_at).getTime()) / 60000) > target);

    await signIn(page, 'lab@enlogada.com', PASSWORD);
    await openScreen(page, 'Laboratory Worklist');
    const badges = page.getByTestId('worklist-over-target');
    if (late.length) {
      // Oldest first, so the first page holds the longest waits.
      // One badge says it: the wait, and that it is past the target.
      await expect(badges.first()).toContainText(new RegExp(`waiting, over the ${target}-min target$`), { timeout: 20000 });
    } else {
      await expect(page.getByRole('heading', { name: 'Laboratory Worklist' })).toBeVisible({ timeout: 20000 });
      await expect(badges, 'no target set, or nothing past it: nothing flagged').toHaveCount(0);
    }
  });

  test('the backup status is for whoever reads the Activity Log, and no one else', async () => {
    const res = await ctx.get(`${API}/admin/backups`, { headers: auth(clinicAdmin) });
    expect(res.status()).toBe(200);
    const status = (await res.json()).data;
    expect(typeof status.enabled).toBe('boolean');
    expect(status).toHaveProperty('lastSuccessAt');
    expect(status).toHaveProperty('lastFailureAt');
    expect((await ctx.get(`${API}/admin/backups`, { headers: auth(reception) })).status()).toBe(403);
  });
});
