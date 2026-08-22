// @ts-check
import { test, expect, request } from 'playwright/test';
import { loginAs } from './helpers/ticketRelease.js';
import { selfPayProfile } from './helpers/patients.js';
import { daysAgoStr } from '../../src/lib/date.js';

// Booking atomicity and duplicate handling.
//
// Online booking used to be three sequential HTTP calls — create the appointment, attach the
// tests, file the HMO claim — each committing on its own. A failure in the second or third left
// an appointment that existed while the patient was told the booking had failed. Because a
// non-cancelled appointment occupies its slot, and max_concurrent_bookings is seeded to 1, that
// phantom then refused the patient's own retry as "no longer available", steering them into
// booking a second, different slot. Two slots, one patient.
//
// POST /appointments now does all of it in one transaction, and recognises a repeat of a booking
// the same patient already holds instead of reporting a slot conflict. These tests lock in both
// halves; without them the failure is invisible until a receptionist notices a queue entry with
// nothing attached to it.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const CLIENT = { email: 'client@enlogada.com', password: 'Password123!' };

// Far enough out that the seeded schedule is open and nothing else in the suite competes for it.
const BOOKING_DATE = '2026-11-18';

test.describe('Booking atomicity (API)', () => {
  let apiContext;
  let clientToken;
  let patientId;
  let testIds;

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    clientToken = await loginAs(apiContext, API, CLIENT);

    const profilesRes = await apiContext.get(`${API}/patients/my-profiles`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    patientId = selfPayProfile((await profilesRes.json()).data.patients).id;

    const testsRes = await apiContext.get(`${API}/tests`);
    testIds = (await testsRes.json()).data.tests.slice(0, 2).map((t) => t.id);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  async function freeSlot(date) {
    const res = await apiContext.get(`${API}/appointments/availability?date=${date}`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    return (await res.json()).data.slots.filter((s) => s.available);
  }

  // Slots this file has already used. Taking `slots[0]` each time is not enough on its own: a dev
  // database whose slot cap has been lifted (cleanE2eData.js --unlimited-slots, which exists
  // precisely because 18 slots a day cannot absorb repeated suite runs) still reports a booked
  // slot as available, so every test would book the same one — and the duplicate guard would then
  // correctly answer 200/alreadyBooked, failing the tests that expect a fresh 201. Tracking the
  // slots here makes the spec assert the behaviour it is about rather than the value of a
  // dev-only configuration knob.
  const claimed = new Set();
  async function claimSlot() {
    const slots = await freeSlot(BOOKING_DATE);
    const slot = slots.find((s) => !claimed.has(s.time));
    expect(slot, `no unclaimed slot left on ${BOOKING_DATE}`).toBeTruthy();
    claimed.add(slot.time);
    return slot.time;
  }

  function book(body) {
    return apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      data: { patientId, scheduledDate: BOOKING_DATE, ...body }
    });
  }

  test('one call creates the appointment and attaches its tests together', async () => {
    const res = await book({ scheduledTime: await claimSlot(), testIds });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.appointment.appointment_reference).toBeTruthy();
    expect(body.data.visitTests).toHaveLength(testIds.length);
    expect(body.data.alreadyBooked).toBe(false);
  });

  test('a rejected booking leaves nothing behind and frees its slot', async () => {
    const countMyBookings = async () => {
      const res = await apiContext.get(`${API}/appointments/my-bookings`, {
        headers: { Authorization: `Bearer ${clientToken}` }
      });
      return (await res.json()).data.bookings.length;
    };

    const target = await claimSlot();
    const before = await countMyBookings();

    // An unknown test id fails after the appointment row would have been written. If the write
    // were not transactional, this is exactly where a phantom booking would be created.
    const res = await book({ scheduledTime: target, testIds: [testIds[0], 99999999] });
    expect(res.status()).toBe(404);

    // The assertion that matters, and the one that holds whatever the slot cap is set to: no
    // booking was recorded. Counted rather than filtered by date — the API returns scheduled_date
    // as a UTC instant, so comparing it to a local calendar date is its own source of false
    // results.
    expect(await countMyBookings()).toBe(before);

    // And the slot is still offered. Weaker than it looks on a dev database with the cap lifted,
    // where every slot always reads as free — which is why it is the second assertion, not the
    // first.
    const after = await freeSlot(BOOKING_DATE);
    expect(after.some((s) => s.time === target)).toBe(true);
  });

  test('re-submitting the same booking returns the original, not a slot conflict', async () => {
    const target = await claimSlot();

    const first = await book({ scheduledTime: target, testIds });
    expect(first.status()).toBe(201);
    const firstRef = (await first.json()).data.appointment.appointment_reference;

    // The retry a patient makes when the first response never reached them.
    const second = await book({ scheduledTime: target, testIds });
    expect(second.status()).toBe(200);

    const body = await second.json();
    expect(body.data.alreadyBooked).toBe(true);
    expect(body.data.appointment.appointment_reference).toBe(firstRef);
  });

  // A 1x1 PNG, so the server's MIME filter sees a genuine image rather than bytes we made up.
  const CARD_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

  function bookWithCard({ scheduledTime, testIds: ids, providerId, withCard }) {
    // FormData rather than the plain multipart object: testIds[] is a repeated field, and only
    // FormData can carry the same name more than once.
    const form = new FormData();
    form.append('patientId', String(patientId));
    form.append('scheduledDate', BOOKING_DATE);
    form.append('scheduledTime', scheduledTime);
    form.append('notes', 'card-spec');
    // The [] suffix is required: it makes a single test arrive as a one-element array.
    ids.forEach((id) => form.append('testIds[]', String(id)));
    form.append('hmo[providerId]', String(providerId));
    form.append('hmo[approvalCode]', 'LOA-E2E');
    // Mandatory on an HMO claim since [1.23.0] — the LOA is issued against the requesting doctor.
    form.append('referringPhysician', 'Dr. E2E Referrer');
    if (withCard) {
      form.append('hmoCard', new Blob([CARD_PNG], { type: 'image/png' }), 'card.png');
    }
    return apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      multipart: form
    });
  }

  test('an HMO claim filed with a card starts Pending, never self-approved', async () => {
    const providersRes = await apiContext.get(`${API}/hmo/providers`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    const providerId = (await providersRes.json()).data.providers[0].id;

    const res = await bookWithCard({
      scheduledTime: await claimSlot(), testIds, providerId, withCard: true
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.hmoRequest).toBeTruthy();
    expect(body.data.hmoRequest.status).toBe('Pending');
  });

  // The card is mandatory, so this is the case that decides whether the guard actually holds.
  // Asserting the slot too is the point: the card is written to disk before the transaction
  // opens, so a rejection has to roll back the booking AND drop the file.
  test('an HMO claim with no card is refused and consumes no slot', async () => {
    const target = await claimSlot();
    const providersRes = await apiContext.get(`${API}/hmo/providers`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    const providerId = (await providersRes.json()).data.providers[0].id;

    const res = await bookWithCard({
      scheduledTime: target, testIds, providerId, withCard: false
    });
    expect(res.status()).toBe(400);

    const after = await freeSlot(BOOKING_DATE);
    expect(after.some((s) => s.time === target)).toBe(true);
  });

  // The rule lives in hmoService, not just the booking controller, so the standalone route is
  // not a way around it.
  test('a client cannot file a card-less claim on the standalone HMO route', async () => {
    const providersRes = await apiContext.get(`${API}/hmo/providers`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    const providerId = (await providersRes.json()).data.providers[0].id;

    const booked = await book({ scheduledTime: await claimSlot(), testIds });
    expect(booked.status()).toBe(201);
    const visitTestIds = (await booked.json()).data.visitTests.map((vt) => vt.id);

    const res = await apiContext.post(`${API}/hmo/request`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      data: { hmoProviderId: providerId, visitTestIds }
    });
    expect(res.status()).toBe(400);
    // Asserted on the message, not just the status: a claim now has two ways to be refused with
    // 400 — no card, and no referring physician [1.23.0] — and a test that accepts either is no
    // longer testing the rule in its own title.
    expect((await res.json()).message).toMatch(/hmo card/i);
  });

  // A booking may be for today or later, never before. [1.33.0]
  //
  // The date picker has carried min={todayStr()} all along, but nothing on the server compared
  // the date to today — so POST /appointments would create a real visit and a real appointment
  // row for last week, occupying a slot on a day that has already happened, on a queue nobody
  // will ever call. `min` is a browser hint; it does not exist for anything talking to the API.
  test('a booking in the past is refused, and its slot is never consumed', async () => {
    const yesterday = daysAgoStr(1);

    const res = await apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      data: { patientId, scheduledDate: yesterday, scheduledTime: '09:00', testIds },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/already passed|from today onwards/i);

    // Nothing was written. Counted rather than filtered by date, for the reason the sibling test
    // gives: the API serialises scheduled_date as a UTC instant.
    const mine = await apiContext.get(`${API}/appointments/my-bookings`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    const bookings = (await mine.json()).data.bookings;
    expect(bookings.some((b) => String(b.scheduled_date).startsWith(yesterday))).toBe(false);
  });

  // The screen and the API must agree: a client should never be offered a slot the server would
  // then refuse. Availability answers "closed" for a past day rather than erroring, because a
  // date-picker keystroke turning into a red toast is not what a closed day looks like.
  test('a past date offers no slots at all', async () => {
    const res = await apiContext.get(`${API}/appointments/availability?date=${daysAgoStr(1)}`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    expect(res.status()).toBe(200);
    const data = (await res.json()).data;
    expect(data.isOpen).toBe(false);
    expect(data.slots).toHaveLength(0);
  });

  test('the Self-Pay sentinel is rejected rather than stored as a null provider', async () => {
    const res = await book({
      scheduledTime: await claimSlot(),
      testIds,
      // The UI's "Self-Pay / None" option carries this string; it must never be treated as a
      // provider id, which is how it previously reached the database as NaN.
      hmo: { providerId: 'none' }
    });

    expect(res.status()).toBe(400);
  });
});
