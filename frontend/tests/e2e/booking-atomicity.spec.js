// @ts-check
import { test, expect, request } from 'playwright/test';
import { loginAs } from './helpers/ticketRelease.js';

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
    patientId = (await profilesRes.json()).data.patients[0].id;

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

  function book(body) {
    return apiContext.post(`${API}/appointments`, {
      headers: { Authorization: `Bearer ${clientToken}` },
      data: { patientId, scheduledDate: BOOKING_DATE, ...body }
    });
  }

  test('one call creates the appointment and attaches its tests together', async () => {
    const slots = await freeSlot(BOOKING_DATE);
    const res = await book({ scheduledTime: slots[0].time, testIds });

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

    const slots = await freeSlot(BOOKING_DATE);
    const target = slots[0].time;
    const before = await countMyBookings();

    // An unknown test id fails after the appointment row would have been written. If the write
    // were not transactional, this is exactly where a phantom booking would be created.
    const res = await book({ scheduledTime: target, testIds: [testIds[0], 99999999] });
    expect(res.status()).toBe(404);

    // The two assertions that matter: the slot did not get consumed, and no booking was recorded.
    // Counted rather than filtered by date — the API returns scheduled_date as a UTC instant, so
    // comparing it to a local calendar date is its own source of false results.
    const after = await freeSlot(BOOKING_DATE);
    expect(after.some((s) => s.time === target)).toBe(true);
    expect(await countMyBookings()).toBe(before);
  });

  test('re-submitting the same booking returns the original, not a slot conflict', async () => {
    const slots = await freeSlot(BOOKING_DATE);
    const target = slots[0].time;

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

  test('an HMO claim filed during booking starts Pending, never self-approved', async () => {
    const slots = await freeSlot(BOOKING_DATE);
    const providersRes = await apiContext.get(`${API}/hmo/providers`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    const providerId = (await providersRes.json()).data.providers[0].id;

    const res = await book({
      scheduledTime: slots[0].time,
      testIds,
      hmo: { providerId, approvalCode: 'LOA-E2E' }
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.hmoRequest).toBeTruthy();
    expect(body.data.hmoRequest.status).toBe('Pending');
  });

  test('the Self-Pay sentinel is rejected rather than stored as a null provider', async () => {
    const slots = await freeSlot(BOOKING_DATE);
    const res = await book({
      scheduledTime: slots[0].time,
      testIds,
      // The UI's "Self-Pay / None" option carries this string; it must never be treated as a
      // provider id, which is how it previously reached the database as NaN.
      hmo: { providerId: 'none' }
    });

    expect(res.status()).toBe(400);
  });
});
