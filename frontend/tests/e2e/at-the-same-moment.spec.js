// @ts-check
import { test, expect, request } from 'playwright/test';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { appointmentForm } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { submitProof, ensureMethod } from './helpers/payments.js';
import { reportPart } from './helpers/reportFile.js';

/**
 * What if two things happen at the same moment? [1.169.0]
 *
 * Steven: "check what ifs scenario like two people book the same time and many more types that can
 * happen in the system". The suite already fired six races (two patients for a one-seat slot, two
 * cashiers on one visit, two desks on one booking, one reference at two tills, two packages at once,
 * one emailed code twice). These are the rest: every pair of people who can touch the same record
 * at once. Each fires its requests together and then checks what the clinic would see afterwards,
 * because a race that answers two 200s can still leave a bill, a slot or a receipt wrong.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const ok = (s) => s >= 200 && s < 300;
const money = (n) => Number(n).toFixed(2);

test.describe('At the same moment [1.169.0]', () => {
  let ctx;
  let desk, till, otherTill, admin, superAdmin, lab;
  let labTests;
  // Ultrasound wherever the department does not matter, so these patients do not crowd the first page
  // of Laboratory's records that department-scoping.spec.js reads.
  let usTests;
  let method;

  const login = async (email) => (await (await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).json()).data.token;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [desk, till, otherTill, admin, superAdmin, lab] = await Promise.all([
      'receptionist@enlogada.com', 'multirole@enlogada.com', 'admin@enlogada.com',
      'clinicadmin@enlogada.com', 'admin@enlogada.com', 'lab@enlogada.com',
    ].map(login));
    otherTill = superAdmin;
    labTests = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .filter((t) => t.category_name === 'Laboratory' && t.is_active && Number(t.price) > 0);
    usTests = ((await (await ctx.get(`${API}/tests`)).json()).data.tests || [])
      .filter((t) => t.category_name === 'Ultrasound' && t.is_active && Number(t.price) > 0);
    method = await ensureMethod(ctx, superAdmin);
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  // ── people and visits ──────────────────────────────────────────────────────────────────────
  const client = async () => {
    const person = fixturePerson();
    const { token } = await registerClient(ctx, { ...person, email: fixtureEmail(person), password: PASSWORD });
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1990-01-01', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    return { token, patient };
  };
  const walkIn = async (testIds = [usTests[0].id, usTests[1].id]) => {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: { patientTypeId: await patientTypeId(ctx, API, desk), ...person, birthdate: '1980-04-04', sex: 'Female', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const res = await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', testIds } });
    expect(res.status(), await res.text()).toBe(201);
    return { patient, visit: (await res.json()).data.visit };
  };
  const book = (c, date, time, testIds = [usTests[0].id]) => ctx.post(`${API}/appointments`, {
    headers: auth(c.token),
    multipart: appointmentForm({ patientId: c.patient.id, scheduledDate: date, scheduledTime: time, testIds }),
  });
  const appointmentOf = async (res) => (await res.json()).data.appointment;
  const move = (token, id, date, time) => ctx.put(`${API}/appointments/${id}/reschedule`, {
    headers: auth(token), data: { scheduledDate: date, scheduledTime: time, reason: 'Schedule conflict' },
  });
  const override = (body) => ctx.put(`${API}/schedule/overrides`, { headers: auth(superAdmin), data: body });
  const clearOverride = (date) => ctx.delete(`${API}/schedule/overrides/${date}`, { headers: auth(superAdmin) });
  const oneSlotDay = async (date, seats) => {
    const res = await override({ date, isOpen: true, openTime: '09:00', closeTime: '10:00', slotIntervalMinutes: 30, maxConcurrentBookings: seats });
    expect(res.status(), await res.text()).toBeLessThan(300);
  };

  // ── money ──────────────────────────────────────────────────────────────────────────────────
  const billOf = async (visitId) => (await (await ctx.get(`${API}/payments/bill/${visitId}`, { headers: auth(till) })).json()).data.bill;
  const paymentsOf = async (visitId) => (await (await ctx.get(`${API}/payments/visit/${visitId}`, { headers: auth(till) })).json()).data.payments;
  const paidOf = async (visitId) => (await paymentsOf(visitId)).filter((p) => p.payment_status === 'Paid');
  const pay = (visitId, amount, token = till, extra = {}) => ctx.post(`${API}/payments`, {
    headers: auth(token), data: { patientVisitId: visitId, paymentMethod: 'Cash', amount, ...extra },
  });
  const linesOf = async (visitId) => (await (await ctx.get(`${API}/tests/visit-tests/${visitId}`, { headers: auth(desk) })).json()).data.visitTests;
  const submissionsOf = async (visitId, token) => {
    const res = await ctx.get(`${API}/payment-submissions/visit/${visitId}`, { headers: auth(token) });
    const d = (await res.json()).data;
    return d.submissions || (d.submission ? [d.submission] : []);
  };

  // ── 1. Bookings and slots ──────────────────────────────────────────────────────────────────

  test('six patients for a slot with two seats: exactly two get it', async () => {
    const day = nthWorkingDay(221);
    await oneSlotDay(day, 2);
    try {
      const people = await Promise.all([1, 2, 3, 4, 5, 6].map(() => client()));
      const codes = (await Promise.all(people.map((c) => book(c, day, '09:00')))).map((r) => r.status());
      expect(codes.filter((s) => s === 201), `answers: ${codes}`).toHaveLength(2);
      expect(codes.filter((s) => s === 409), 'everyone else is told the time is taken').toHaveLength(4);
      const grid = (await (await ctx.get(`${API}/appointments/availability`, { headers: auth(people[0].token), params: { date: day } })).json()).data;
      const nine = (grid.slots || grid.availability?.slots || []).find((s) => String(s.time).startsWith('09:00'));
      expect(nine?.available, 'and the slot now reads full').toBe(false);
    } finally { await clearOverride(day); }
  });

  test('one patient tapping Book twice at once gets one booking, not two', async () => {
    const c = await client();
    const day = nthWorkingDay(222);
    const both = await Promise.all([book(c, day, '10:00'), book(c, day, '10:00')]);
    const codes = both.map((r) => r.status());
    expect(codes.every(ok), `answers: ${codes}`).toBe(true);
    const ids = await Promise.all(both.map(async (r) => (await appointmentOf(r)).id));
    expect(ids[0], 'both answers name the same booking').toBe(ids[1]);
    const mine = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(c.token) })).json()).data;
    const list = mine.appointments || mine.bookings || mine;
    expect(list.filter((a) => a.id === ids[0]).length, 'that booking is listed once').toBe(1);
    expect(list.length, 'and it is the only booking this new patient has').toBe(1);
  });

  test('two bookings moved into the last seat at once: one moves, one is told no', async () => {
    const from = nthWorkingDay(223);
    const to = nthWorkingDay(224);
    await oneSlotDay(to, 1);
    try {
      const [a, b] = [await client(), await client()];
      const ba = await appointmentOf(await book(a, from, '09:00'));
      const bb = await appointmentOf(await book(b, from, '09:30'));
      const codes = (await Promise.all([move(a.token, ba.id, to, '09:00'), move(b.token, bb.id, to, '09:00')])).map((r) => r.status()).sort();
      expect(codes).toEqual([200, 409]);
    } finally { await clearOverride(to); }
  });

  test('a new booking and a moved one race for the last seat: one gets it', async () => {
    const from = nthWorkingDay(225);
    const to = nthWorkingDay(226);
    await oneSlotDay(to, 1);
    try {
      const [mover, newcomer] = [await client(), await client()];
      const appt = await appointmentOf(await book(mover, from, '09:00'));
      const [moved, booked] = await Promise.all([move(mover.token, appt.id, to, '09:00'), book(newcomer, to, '09:00')]);
      const won = [moved.status() === 200, booked.status() === 201].filter(Boolean).length;
      expect(won, `move ${moved.status()}, book ${booked.status()}`).toBe(1);
    } finally { await clearOverride(to); }
  });

  test('the patient releases a booking while the desk checks it in: one of the two, never both', async () => {
    const c = await client();
    const appt = await appointmentOf(await book(c, nthWorkingDay(227), '09:00'));
    const [released, checkedIn] = await Promise.all([
      ctx.post(`${API}/appointments/${appt.id}/release`, { headers: auth(c.token) }),
      ctx.patch(`${API}/appointments/${appt.id}/status`, { headers: auth(desk), data: { status: 'Confirmed' } }),
    ]);
    const outcomes = [ok(released.status()), ok(checkedIn.status())];
    expect(outcomes.filter(Boolean).length, `release ${released.status()}, check-in ${checkedIn.status()}`).toBe(1);
    const still = await ctx.get(`${API}/visits/${appt.patient_visit_id}`, { headers: auth(desk) });
    if (ok(released.status())) expect(still.status(), 'released means gone').toBe(404);
    else expect((await still.json()).data.visit.queue_number, 'checked in means a ticket').toBeTruthy();
  });

  // ── 2. Money ───────────────────────────────────────────────────────────────────────────────

  test('two cashiers verify the same online payment at once: one receipt', async () => {
    const c = await client();
    const appt = await appointmentOf(await book(c, nthWorkingDay(228), '09:00'));
    const visitId = appt.patient_visit_id;
    const amount = Number((await billOf(visitId)).totalAmount);
    const proof = await submitProof(ctx, c.token, visitId, { amount, reference: `RACE${Date.now()}`, methodId: method.id });
    expect(proof.status(), await proof.text()).toBe(201);
    const id = (await proof.json()).data.submission.id;
    const codes = (await Promise.all([
      ctx.post(`${API}/payment-submissions/${id}/verify`, { headers: auth(till) }),
      ctx.post(`${API}/payment-submissions/${id}/verify`, { headers: auth(otherTill) }),
    ])).map((r) => r.status()).sort();
    expect(codes, 'one verifies, the other is told it is done').toEqual([200, 409]);
    expect(await paidOf(visitId)).toHaveLength(1);
  });

  test('one cashier verifies a proof while another rejects it: the visit ends one way only', async () => {
    const c = await client();
    const appt = await appointmentOf(await book(c, nthWorkingDay(229), '09:00'));
    const visitId = appt.patient_visit_id;
    const amount = Number((await billOf(visitId)).totalAmount);
    const id = (await (await submitProof(ctx, c.token, visitId, { amount, reference: `RACE${Date.now()}`, methodId: method.id })).json()).data.submission.id;
    const [verified, rejected] = await Promise.all([
      ctx.post(`${API}/payment-submissions/${id}/verify`, { headers: auth(till) }),
      ctx.post(`${API}/payment-submissions/${id}/reject`, { headers: auth(otherTill), data: { reviewNote: 'The reference does not match our statement.' } }),
    ]);
    expect([ok(verified.status()), ok(rejected.status())].filter(Boolean).length, `verify ${verified.status()}, reject ${rejected.status()}`).toBe(1);
    const paid = await paidOf(visitId);
    expect(paid.length, 'a receipt exactly when the verify won').toBe(ok(verified.status()) ? 1 : 0);
  });

  test('the patient sends a proof while the cashier takes cash at the counter: paid once', async () => {
    const c = await client();
    const appt = await appointmentOf(await book(c, nthWorkingDay(230), '09:00'));
    const visitId = appt.patient_visit_id;
    const amount = Number((await billOf(visitId)).totalAmount);
    const [proof, counter] = await Promise.all([
      submitProof(ctx, c.token, visitId, { amount, reference: `RACE${Date.now()}`, methodId: method.id }),
      pay(visitId, amount),
    ]);
    const paid = await paidOf(visitId);
    expect(paid.length, `proof ${proof.status()}, counter ${counter.status()}`).toBeLessThanOrEqual(1);
    if (ok(counter.status())) {
      const waiting = (await submissionsOf(visitId, till)).filter((s) => s.status === 'Pending');
      expect(waiting, 'no proof left waiting on a visit already paid at the counter').toHaveLength(0);
    }
  });

  test('the desk adds a test while the cashier takes payment: the receipt covers every test on the visit', async () => {
    const { visit } = await walkIn([usTests[0].id]);
    const amount = Number((await billOf(visit.id)).totalAmount);
    const [added, paid] = await Promise.all([
      ctx.post(`${API}/tests/visit-tests`, { headers: auth(desk), data: { patientVisitId: visit.id, testIds: [usTests[2].id] } }),
      pay(visit.id, amount),
    ]);
    const lines = (await linesOf(visit.id)).filter((l) => l.status !== 'Cancelled');
    const total = lines.reduce((s, l) => s + Number(l.price_at_time), 0);
    const receipts = await paidOf(visit.id);
    if (receipts.length) {
      expect(money(receipts[0].amount), `add ${added.status()}, pay ${paid.status()}: nothing on the visit goes unpaid`).toBe(money(total));
    }
    expect(ok(added.status()) && ok(paid.status()) && lines.length === 1, 'never both answered yes and the test missing').toBe(false);
  });

  test('a discount applied while the cashier takes payment: the receipt is the final bill', async () => {
    const { visit } = await walkIn([usTests[0].id, usTests[1].id]);
    const { discounts } = (await (await ctx.get(`${API}/discounts`, { headers: auth(till) })).json()).data;
    const pwd = discounts.find((t) => /pwd/i.test(t.name));
    const amount = Number((await billOf(visit.id)).totalAmount);
    const [discount, paid] = await Promise.all([
      ctx.post(`${API}/discounts/visit/${visit.id}`, { headers: auth(otherTill), data: { discountTypeId: pwd.id, idNumber: 'PWD-RACE-001' } }),
      pay(visit.id, amount),
    ]);
    const receipts = await paidOf(visit.id);
    if (receipts.length) {
      const bill = await billOf(visit.id);
      expect(money(receipts[0].amount), `discount ${discount.status()}, pay ${paid.status()}`).toBe(money(bill.totalAmount));
    }
  });

  test('a refund pressed twice at once: one refund', async () => {
    const { visit } = await walkIn([usTests[0].id]);
    const amount = Number((await billOf(visit.id)).totalAmount);
    const payment = (await (await pay(visit.id, amount)).json()).data.payment;
    const body = { kind: 'recorded_by_mistake', reason: 'Taken on the wrong visit.', returnedVia: 'Cash' };
    const codes = (await Promise.all([
      ctx.post(`${API}/payments/${payment.id}/refund`, { headers: auth(superAdmin), data: body }),
      ctx.post(`${API}/payments/${payment.id}/refund`, { headers: auth(superAdmin), data: body }),
    ])).map((r) => r.status());
    expect(codes.filter(ok), `answers: ${codes}`).toHaveLength(1);
    expect(codes.some((s) => s >= 500), 'never a server error').toBe(false);
    const options = (await (await ctx.get(`${API}/payments/${payment.id}/refund`, { headers: auth(superAdmin) })).json()).data;
    expect(Number(options.refunded), 'the receipt refunded once, not twice').toBeCloseTo(Number(payment.amount), 2);
  });

  // ── 3. HMO claims ──────────────────────────────────────────────────────────────────────────

  const claimOn = async (visitId) => {
    const provider = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(desk) })).json()).data.providers[0];
    const ids = (await linesOf(visitId)).map((l) => l.id);
    const res = await ctx.post(`${API}/hmo/request`, {
      headers: auth(desk), data: { hmoProviderId: provider.id, memberNumber: '1CH-0000099', visitTestIds: ids, referringPhysician: 'Dr. Reyes' },
    });
    expect(res.status(), await res.text()).toBe(201);
    const d = (await res.json()).data;
    return (d.request || d.hmoRequest || d).id;
  };

  test('one Admin approves a claim while another turns it down: one decision, and the bill follows it', async () => {
    const { visit } = await walkIn([usTests[0].id]);
    const id = await claimOn(visit.id);
    const [approved, refused] = await Promise.all([
      ctx.put(`${API}/hmo/request/${id}/approve`, { headers: auth(admin), data: { approvalCode: 'LOA-RACE' } }),
      ctx.put(`${API}/hmo/request/${id}/reject`, { headers: auth(superAdmin), data: { decisionReason: "Member's policy lapsed" } }),
    ]);
    expect([ok(approved.status()), ok(refused.status())].filter(Boolean).length, `approve ${approved.status()}, refuse ${refused.status()}`).toBe(1);
    const bill = await billOf(visit.id);
    expect(money(bill.hmoCoverage), 'covered exactly when the approval won').toBe(ok(approved.status()) ? money(bill.subtotal) : '0.00');
  });

  test('an Admin approves a claim while the cashier charges in full and withdraws it: never both', async () => {
    const { visit } = await walkIn([usTests[0].id]);
    const id = await claimOn(visit.id);
    const full = Number((await billOf(visit.id)).subtotal);
    const [approved, paid] = await Promise.all([
      ctx.put(`${API}/hmo/request/${id}/approve`, { headers: auth(admin), data: { approvalCode: 'LOA-RACE' } }),
      pay(visit.id, full, till, { withdrawPendingClaims: true }),
    ]);
    const bill = await billOf(visit.id);
    const receipts = await paidOf(visit.id);
    const chargedInFull = receipts.some((p) => money(p.amount) === money(full));
    expect(chargedInFull && Number(bill.hmoCoverage) > 0, `approve ${approved.status()}, pay ${paid.status()}: the patient and the HMO never both pay`).toBe(false);
  });

  // ── 4. Reports ─────────────────────────────────────────────────────────────────────────────

  const paidLabLine = async () => {
    const { visit } = await walkIn([labTests[0].id]);
    expect((await pay(visit.id, Number((await billOf(visit.id)).totalAmount))).status()).toBe(201);
    return (await linesOf(visit.id))[0];
  };
  const versionsOf = async (visitTestId) => {
    const d = (await (await ctx.get(`${API}/results/${visitTestId}/versions`, { headers: auth(lab) })).json()).data;
    return d.versions || d.history || [];
  };

  test('two technologists attach a report to the same test at once: one current version, no error', async () => {
    const line = await paidLabLine();
    const codes = (await Promise.all([
      ctx.post(`${API}/results/${line.id}`, { headers: auth(lab), multipart: { file: reportPart('first') } }),
      ctx.post(`${API}/results/${line.id}`, { headers: auth(lab), multipart: { file: reportPart('second') } }),
    ])).map((r) => r.status());
    expect(codes.some((s) => s >= 500), `answers: ${codes}`).toBe(false);
    const current = await ctx.get(`${API}/results/${line.id}`, { headers: auth(lab) });
    expect(current.status()).toBe(200);
    const versions = await versionsOf(line.id);
    const numbers = versions.map((v) => v.version);
    expect(new Set(numbers).size, `versions ${numbers}`).toBe(numbers.length);
  });

  test('Release pressed twice at once: released once, with one verification code', async () => {
    const line = await paidLabLine();
    expect((await ctx.post(`${API}/results/${line.id}`, { headers: auth(lab), multipart: { file: reportPart('lab') } })).status()).toBeLessThan(300);
    const codes = (await Promise.all([
      ctx.post(`${API}/results/${line.id}/release`, { headers: auth(lab) }),
      ctx.post(`${API}/results/${line.id}/release`, { headers: auth(lab) }),
    ])).map((r) => r.status());
    expect(codes.some((s) => s >= 500), `answers: ${codes}`).toBe(false);
    expect(codes.filter(ok).length, `answers: ${codes}`).toBeGreaterThanOrEqual(1);
    const released = (await versionsOf(line.id)).filter((v) => v.authorised_at || v.authorisedAt);
    expect(released, 'one released version').toHaveLength(1);
  });

  // ── 5. The desk ────────────────────────────────────────────────────────────────────────────

  test('two desks each remove a different test from a two-test visit at once: the visit keeps one', async () => {
    const { visit } = await walkIn([usTests[0].id, usTests[1].id]);
    const [a, b] = await linesOf(visit.id);
    const codes = (await Promise.all([
      ctx.delete(`${API}/tests/visit-tests/${a.id}`, { headers: auth(desk) }),
      ctx.delete(`${API}/tests/visit-tests/${b.id}`, { headers: auth(till) }),
    ])).map((r) => r.status());
    const left = (await linesOf(visit.id)).filter((l) => l.status !== 'Cancelled');
    expect(left.length, `answers: ${codes}: a visit is never left with no test`).toBe(1);
  });

  test('the same new walk-in registered at two desks at once: one record, the other is asked', async () => {
    const person = fixturePerson();
    const typeId = await patientTypeId(ctx, API, desk);
    const register = (token) => ctx.post(`${API}/visits`, {
      headers: auth(token),
      data: {
        visitType: 'Walk in', testIds: [usTests[0].id],
        patient: {
          ...person, patientTypeId: typeId, birthdate: '1977-07-07', sex: 'Male', contactNumber: FIXTURE_CONTACT, address: 'Bugo, Cagayan de Oro City',
        },
      },
    });
    const codes = (await Promise.all([register(desk), register(till)])).map((r) => r.status()).sort();
    expect(codes, 'one registers, the other is told the person may already be on file').toEqual([201, 409]);
  });
});
