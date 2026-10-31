// @ts-check
import { test, expect, request } from 'playwright/test';
import { signIn } from './helpers/auth.js';
import { openBooking } from './helpers/portal.js';
import { appointmentForm, bookableTestId } from './helpers/booking.js';
import { todayStr } from './helpers/dates.js';

/**
 * A booking needs an hour's notice. [1.144.0]
 *
 * Steven booked 11:00 when it was 11:00, and it went through: the server refused only a slot whose
 * start had passed, so 10:59 for 11:00 was accepted, and a time grid opened before 11:00 kept
 * offering it afterwards. Now a time less than an hour away is neither offered nor accepted, and the
 * grid says why.
 *
 * Today has to be open around the clock for this to be checkable at any hour, so the spec opens it
 * with a date override and removes the override afterwards. If today already has one (the clinic's
 * own), it leaves the day alone and skips.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';
const NOTICE = 60;

const minuteNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const toMinutes = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };

test.describe('Booking notice', () => {
  let ctx; let admin; let client; let patientId;
  let ownOverride = false;
  const today = todayStr();
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const login = async (email) => {
    const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok(), `sign-in for ${email}`).toBeTruthy();
    return (await res.json()).data.token;
  };
  const availability = async () => (await (await ctx.get(`${API}/appointments/availability`, {
    headers: auth(client), params: { date: today },
  })).json()).data;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [admin, client] = await Promise.all([login('admin@enlogada.com'), login('client@enlogada.com')]);
    patientId = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: auth(client) })).json()).data.patients[0].id;

    const existing = (await (await ctx.get(`${API}/schedule/overrides`, { headers: auth(admin), params: { from: today } })).json())
      .data.overrides.find((o) => o.override_date === today);
    if (existing) return;
    const set = await ctx.put(`${API}/schedule/overrides`, {
      headers: auth(admin),
      data: { date: today, isOpen: true, openTime: '00:00', closeTime: '23:59', maxConcurrentBookings: 20 },
    });
    expect(set.status(), await set.text()).toBe(200);
    ownOverride = true;
  });

  test.afterAll(async () => {
    // Leave today's hours as they were.
    if (ownOverride) await ctx.delete(`${API}/schedule/overrides/${today}`, { headers: auth(admin) });
    await ctx?.dispose();
  });

  test('a time less than an hour away is not offered, and says it is too soon', async () => {
    test.skip(!ownOverride, 'Today already has its own date override; left alone.');
    const before = minuteNow();
    const day = await availability();
    const after = minuteNow();

    expect(day.noticeMinutes).toBe(NOTICE);
    for (const slot of day.slots) {
      const m = toMinutes(slot.time);
      if (m < before + NOTICE) {
        expect(slot.available, `${slot.time} is under an hour away`).toBe(false);
        expect(slot.tooSoon, `${slot.time} says why`).toBe(true);
      } else if (m >= after + NOTICE) {
        expect(slot.tooSoon, `${slot.time} is an hour or more away`).toBeFalsy();
      }
    }
  });

  test('the server refuses one, and names the earliest time it would take', async () => {
    test.skip(!ownOverride, 'Today already has its own date override; left alone.');
    const now = minuteNow();
    const day = await availability();
    // The slot that starts soonest from now without having started: the one Steven booked.
    const soon = day.slots.find((s) => toMinutes(s.time) > now) || day.slots[day.slots.length - 1];
    expect(toMinutes(soon.time) - now, 'a slot less than an hour away').toBeLessThan(NOTICE);

    const res = await ctx.post(`${API}/appointments`, {
      headers: auth(client),
      multipart: appointmentForm({ patientId, scheduledDate: today, scheduledTime: soon.time, testIds: [await bookableTestId(ctx)] }),
    });
    expect(res.status(), 'booked under an hour ahead').toBe(409);
    expect((await res.json()).message).toMatch(/at least 1 hour ahead\. (The earliest time today is \d{1,2}:\d{2} [AP]M|There are no more times today)/);
  });

  test('the time picker says why earlier times today are missing', async ({ page }) => {
    test.skip(!ownOverride, 'Today already has its own date override; left alone.');
    await signIn(page, 'client@enlogada.com');
    const dialog = await openBooking(page);
    await dialog.locator('#slotpicker-label').fill(today);
    // Before 22:59 a later time is still offered and the line under the grid explains the gap;
    // after it, nothing is left today, and the grid says so rather than "already booked".
    await expect(dialog.getByTestId('slots-notice').or(dialog.getByTestId('slots-none-left'))).toBeVisible({ timeout: 15000 });
    await expect(dialog).toContainText(/at least 1 hour ahead/i);
    await expect(dialog).not.toContainText(/already booked/i);
  });
});
