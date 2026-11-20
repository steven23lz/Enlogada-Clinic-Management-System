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
 * Every process, four ways. [1.170.0]
 *
 * Steven: "triple or quadruple check every process we have in the system to make sure no bugs or
 * possible bugs can happen". Four passes over every door a record can be changed through:
 *   1. timing   two things at once, beyond at-the-same-moment.spec.js
 *   2. whose    one patient reaching for another patient's records
 *   3. state    an action on something already paid, released, moved or removed
 *   4. input    empty, doubled, negative, huge or malformed values
 * Each test says what the clinic would see if it went wrong.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const ok = (s) => s >= 200 && s < 300;

test.describe('Every process, four ways [1.170.0]', () => {
  let ctx;
  let desk, till, admin, superAdmin, lab;
  let usTests, labTests;
  let method;
  const login = async (email) => (await (await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } })).json()).data.token;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [desk, till, admin, superAdmin, lab] = await Promise.all([
      'receptionist@enlogada.com', 'multirole@enlogada.com', 'clinicadmin@enlogada.com', 'admin@enlogada.com', 'lab@enlogada.com',
    ].map(login));
    const all = (await (await ctx.get(`${API}/tests`)).json()).data.tests || [];
    usTests = all.filter((t) => t.category_name === 'Ultrasound' && t.is_active && Number(t.price) > 0);
    labTests = all.filter((t) => t.category_name === 'Laboratory' && t.is_active && Number(t.price) > 0);
    method = await ensureMethod(ctx, superAdmin);
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  const client = async () => {
    const person = fixturePerson();
    const { token } = await registerClient(ctx, { ...person, email: fixtureEmail(person), password: PASSWORD });
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token),
      data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1990-01-01', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    return { token, patient };
  };
  const walkIn = async (testIds = [usTests[0].id]) => {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: { patientTypeId: await patientTypeId(ctx, API, desk), ...person, birthdate: '1980-04-04', sex: 'Female', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const res = await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', testIds } });
    expect(res.status(), await res.text()).toBe(201);
    return { patient, visit: (await res.json()).data.visit };
  };
  const book = (c, date, time, testIds = [usTests[1].id]) => ctx.post(`${API}/appointments`, {
    headers: auth(c.token),
    multipart: appointmentForm({ patientId: c.patient.id, scheduledDate: date, scheduledTime: time, testIds }),
  });
  const appt = async (res) => {
    const body = await res.json();
    expect(body.data?.appointment, JSON.stringify(body).slice(0, 200)).toBeTruthy();
    return body.data.appointment;
  };
  const billOf = async (visitId) => (await (await ctx.get(`${API}/payments/bill/${visitId}`, { headers: auth(till) })).json()).data.bill;
  const pay = async (visitId) => ctx.post(`${API}/payments`, {
    headers: auth(till), data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: Number((await billOf(visitId)).totalAmount) },
  });
  const linesOf = async (visitId) => (await (await ctx.get(`${API}/tests/visit-tests/${visitId}`, { headers: auth(desk) })).json()).data.visitTests;
  const checkIn = (id) => ctx.patch(`${API}/appointments/${id}/status`, { headers: auth(desk), data: { status: 'Confirmed' } });
  const move = (token, id, date, time) => ctx.put(`${API}/appointments/${id}/reschedule`, {
    headers: auth(token), data: { scheduledDate: date, scheduledTime: time, reason: 'Schedule conflict' },
  });
  const paidLabLine = async () => {
    const { visit } = await walkIn([labTests[0].id]);
    expect((await pay(visit.id)).status()).toBe(201);
    return { visit, line: (await linesOf(visit.id))[0] };
  };
  const releasedLabReport = async () => {
    const { visit, line } = await paidLabLine();
    expect((await ctx.post(`${API}/results/${line.id}`, { headers: auth(lab), multipart: { file: reportPart('lab') } })).status()).toBeLessThan(300);
    expect((await ctx.post(`${API}/results/${line.id}/release`, { headers: auth(lab) })).status()).toBe(200);
    return { visit, line };
  };

  // ════ Pass 1. Timing ════════════════════════════════════════════════════════════════════════

  test.describe('1. timing', () => {
    test('a booking moved while the desk checks it in: checked in where it stands, or moved, never both', async () => {
      const c = await client();
      const a = await appt(await book(c, nthWorkingDay(231), '09:00'));
      const [moved, checked] = await Promise.all([move(c.token, a.id, nthWorkingDay(232), '10:00'), checkIn(a.id)]);
      const after = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(c.token) })).json()).data;
      const row = after.bookings.find((x) => x.id === a.id);
      expect([ok(moved.status()), ok(checked.status())].filter(Boolean).length, `move ${moved.status()}, check-in ${checked.status()}`).toBe(1);
      if (ok(checked.status())) expect(row.status).toBe('Confirmed');
    });

    test('the same booking moved to two times at once: it holds one slot', async () => {
      const c = await client();
      const a = await appt(await book(c, nthWorkingDay(233), '09:00'));
      const target = nthWorkingDay(234);
      const codes = (await Promise.all([move(c.token, a.id, target, '10:00'), move(c.token, a.id, target, '11:00')])).map((r) => r.status());
      expect(codes.some((s) => s >= 500), `answers: ${codes}`).toBe(false);
      const after = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: auth(c.token) })).json()).data;
      const mine = after.bookings.filter((x) => x.id === a.id);
      expect(mine).toHaveLength(1);
      expect(['10:00', '11:00']).toContain(String(mine[0].scheduled_time).slice(0, 5));
    });

    test('the patient releases a booking while sending its payment proof: released, or the proof stands, never both', async () => {
      const c = await client();
      const a = await appt(await book(c, nthWorkingDay(235), '09:00'));
      const amount = Number((await billOf(a.patient_visit_id)).totalAmount);
      const [released, proof] = await Promise.all([
        ctx.post(`${API}/appointments/${a.id}/release`, { headers: auth(c.token) }),
        submitProof(ctx, c.token, a.patient_visit_id, { amount, reference: `REL${Date.now()}`, methodId: method.id }),
      ]);
      expect([ok(released.status()), ok(proof.status())].filter(Boolean).length, `release ${released.status()}, proof ${proof.status()}`).toBe(1);
    });

    test('a check-in undone while the department starts the work: never undone with a report on it', async () => {
      const c = await client();
      const a = await appt(await book(c, nthWorkingDay(236), '09:00', [labTests[1].id]));
      expect((await checkIn(a.id)).status()).toBe(200);
      expect((await pay(a.patient_visit_id)).status()).toBe(201);
      const [line] = await linesOf(a.patient_visit_id);
      const [undone, uploaded] = await Promise.all([
        ctx.post(`${API}/appointments/${a.id}/undo-check-in`, { headers: auth(desk), data: { reason: 'Checked in the wrong patient.' } }),
        ctx.post(`${API}/results/${line.id}`, { headers: auth(lab), multipart: { file: reportPart('lab') } }),
      ]);
      expect(ok(undone.status()) && ok(uploaded.status()), `undo ${undone.status()}, upload ${uploaded.status()}`).toBe(false);
    });

    test('a record archived while the desk starts a visit on it: never archived with a visit open', async () => {
      const person = fixturePerson();
      const patient = (await (await ctx.post(`${API}/patients`, {
        headers: auth(desk),
        data: { patientTypeId: await patientTypeId(ctx, API, desk), ...person, birthdate: '1966-06-06', sex: 'Male', contactNumber: FIXTURE_CONTACT },
      })).json()).data.patient;
      const [archived, started] = await Promise.all([
        ctx.patch(`${API}/patients/${patient.id}/archive`, { headers: auth(admin), data: { archived: true } }),
        ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', testIds: [usTests[0].id] } }),
      ]);
      expect(ok(archived.status()) && ok(started.status()), `archive ${archived.status()}, visit ${started.status()}`).toBe(false);
    });

    test('a refund for a test the clinic cannot do, while its report is attached: never refunded with a report', async () => {
      const { line } = await paidLabLine();
      const payment = (await (await ctx.get(`${API}/payments/visit/${line.patient_visit_id}`, { headers: auth(till) })).json()).data.payments[0];
      const [refund, upload] = await Promise.all([
        ctx.post(`${API}/payments/${payment.id}/refund`, {
          headers: auth(superAdmin), data: { kind: 'clinic_cannot_perform', testIds: [line.id], reason: 'The analyser is down.', returnedVia: 'Cash' },
        }),
        ctx.post(`${API}/results/${line.id}`, { headers: auth(lab), multipart: { file: reportPart('lab') } }),
      ]);
      expect(ok(refund.status()) && ok(upload.status()), `refund ${refund.status()}, upload ${upload.status()}`).toBe(false);
    });

    test('a date closed while a patient books it: the booking is refused, or named for moving', async () => {
      const date = nthWorkingDay(237);
      const c = await client();
      const [closed, booked] = await Promise.all([
        ctx.put(`${API}/schedule/overrides`, { headers: auth(superAdmin), data: { date, isOpen: false, note: 'Clinic closed for repairs' } }),
        book(c, date, '09:00'),
      ]);
      try {
        if (ok(closed.status()) && ok(booked.status())) {
          const id = (await booked.json()).data.appointment.id;
          const named = (await (await ctx.get(`${API}/schedule/overrides/${date}/bookings`, { headers: auth(superAdmin) })).json()).data;
          const list = named.bookings || named.affectedBookings || named;
          expect((Array.isArray(list) ? list : []).some((b) => b.id === id || b.appointment_id === id),
            'a booking made on a closed date is on the list of bookings to move').toBe(true);
        }
      } finally {
        await ctx.delete(`${API}/schedule/overrides/${date}`, { headers: auth(superAdmin) });
      }
    });
    test('an HMO claim raised while the cashier takes payment: never a claim on a paid visit', async () => {
      const { visit } = await walkIn([usTests[0].id]);
      const provider = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(desk) })).json()).data.providers[0];
      const [line] = await linesOf(visit.id);
      const [claimed, paid] = await Promise.all([
        ctx.post(`${API}/hmo/request`, {
          headers: auth(desk), data: { hmoProviderId: provider.id, memberNumber: '1CH-0000123', visitTestIds: [line.id], referringPhysician: 'Dr. Reyes' },
        }),
        pay(visit.id),
      ]);
      expect(ok(claimed.status()) && ok(paid.status()), `claim ${claimed.status()}, pay ${paid.status()}`).toBe(false);
    });

    test('two desks start a visit for the same patient at once: one unpaid visit, not two', async () => {
      const person = fixturePerson();
      const patient = (await (await ctx.post(`${API}/patients`, {
        headers: auth(desk),
        data: { patientTypeId: await patientTypeId(ctx, API, desk), ...person, birthdate: '1971-01-01', sex: 'Female', contactNumber: FIXTURE_CONTACT },
      })).json()).data.patient;
      const start = (token) => ctx.post(`${API}/visits`, { headers: auth(token), data: { patientId: patient.id, visitType: 'Walk in', testIds: [usTests[0].id] } });
      const codes = (await Promise.all([start(desk), start(till)])).map((r) => r.status()).sort();
      expect(codes, 'one opens, the other is told the patient is already waiting').toEqual([201, 409]);
    });

    test('the same feedback form sent twice at once: one form', async () => {
      const { line, visit } = await releasedLabReport();
      const questions = (await (await ctx.get(`${API}/feedback/questions`, { headers: auth(admin) })).json()).data;
      const list = questions.questions || questions;
      const answers = { [list[0].id]: 3 };
      const send = () => ctx.post(`${API}/feedback/visits/${visit.id}/paper`, { headers: auth(desk), data: { answers, comment: 'Maayo.' } });
      const codes = (await Promise.all([send(), send()])).map((r) => r.status());
      expect(codes.some((c) => c >= 500), `answers: ${codes}`).toBe(false);
      expect(codes.filter(ok), `answers: ${codes}`).toHaveLength(1);
      expect(line.id).toBeTruthy();
    });
  });

  // ════ Pass 2. Whose ═════════════════════════════════════════════════════════════════════════

  test.describe("2. one patient reaching for another's", () => {
    let owner, stranger, ownerAppt, ownerVisitId;

    test.beforeAll(async () => {
      [owner, stranger] = [await client(), await client()];
      // A free time, since a retried worker runs this again on the same day.
      let res;
      for (const time of ['09:00', '09:30', '10:00', '10:30', '11:00', '13:00', '13:30', '14:00']) {
        res = await book(owner, nthWorkingDay(238), time);
        if (res.status() === 201) break;
      }
      ownerAppt = await appt(res);
      ownerVisitId = ownerAppt.patient_visit_id;
    });

    const refusedFor = async (res, what) => {
      const s = res.status();
      expect([401, 403, 404].includes(s), `${what}: answered ${s}`).toBe(true);
    };

    test("a patient cannot read, pay into or change another patient's booking", async () => {
      const T = auth(stranger.token);
      await refusedFor(await ctx.get(`${API}/visits/${ownerVisitId}`, { headers: T }), 'read the visit');
      await refusedFor(await ctx.get(`${API}/payments/bill/${ownerVisitId}`, { headers: T }), 'read the bill');
      await refusedFor(await ctx.get(`${API}/payment-submissions/visit/${ownerVisitId}`, { headers: T }), 'read its proofs');
      await refusedFor(await submitProof(ctx, stranger.token, ownerVisitId, { amount: 1, reference: `X${Date.now()}`, methodId: method.id }), 'send a proof');
      await refusedFor(await ctx.post(`${API}/appointments/${ownerAppt.id}/release`, { headers: T }), 'release it');
      await refusedFor(await move(stranger.token, ownerAppt.id, nthWorkingDay(239), '10:00'), 'move it');
      await refusedFor(await ctx.post(`${API}/tests/visit-tests`, { headers: T, data: { patientVisitId: ownerVisitId, testIds: [usTests[2].id] } }), 'add a test');
      const [line] = await linesOf(ownerVisitId);
      await refusedFor(await ctx.delete(`${API}/tests/visit-tests/${line.id}`, { headers: T }), 'remove a test');
      await refusedFor(await ctx.get(`${API}/visits/${ownerVisitId}/doctor-request`, { headers: T }), "open the doctor's request");
      await refusedFor(await ctx.put(`${API}/patients/${owner.patient.id}`, {
        headers: T,
        data: {
          patientTypeId: owner.patient.patient_type_id, firstName: 'Changed', lastName: owner.patient.last_name,
          birthdate: '1990-01-01', sex: 'Male', contactNumber: FIXTURE_CONTACT, address: 'Bugo, Cagayan de Oro City',
        },
      }), 'edit the record');
    });

    test("a patient cannot open another patient's report, receipt or feedback form", async () => {
      const { visit, line } = await releasedLabReport();
      const payment = (await (await ctx.get(`${API}/payments/visit/${visit.id}`, { headers: auth(till) })).json()).data.payments[0];
      const T = auth(stranger.token);
      await refusedFor(await ctx.get(`${API}/results/${line.id}/file`, { headers: T }), 'open the report');
      await refusedFor(await ctx.get(`${API}/payments/receipt/${payment.receipt_number}`, { headers: T }), 'open the receipt');
      await refusedFor(await ctx.post(`${API}/feedback/visits/${visit.id}`, { headers: T, data: { answers: {} } }), 'answer feedback on it');
      await refusedFor(await ctx.get(`${API}/results/history/${visit.patient_id}`, { headers: T }), 'read the result history');
    });

    test('a patient cannot act as staff: no payment, no check-in, no claim decision, no report', async () => {
      const T = auth(stranger.token);
      await refusedFor(await ctx.post(`${API}/payments`, { headers: T, data: { patientVisitId: ownerVisitId, paymentMethod: 'Cash', amount: 1 } }), 'take a payment');
      await refusedFor(await ctx.patch(`${API}/appointments/${ownerAppt.id}/status`, { headers: T, data: { status: 'Confirmed' } }), 'check in');
      await refusedFor(await ctx.put(`${API}/hmo/request/1/approve`, { headers: T, data: { approvalCode: 'X' } }), 'approve a claim');
      await refusedFor(await ctx.post(`${API}/discounts/visit/${ownerVisitId}`, { headers: T, data: { discountTypeId: 1, idNumber: 'X' } }), 'apply a discount');
      await refusedFor(await ctx.get(`${API}/patients/search?q=a`, { headers: T }), 'search patients');
      await refusedFor(await ctx.get(`${API}/admin/activity`, { headers: T }), 'read the Activity Log');
    });
  });

  // ════ Pass 3. State ═════════════════════════════════════════════════════════════════════════

  test.describe('3. an action on something already settled', () => {
    test('a withdrawn report cannot be emailed, and a new one can be released after it', async () => {
      const { line } = await releasedLabReport();
      expect((await ctx.post(`${API}/results/${line.id}/withdraw`, { headers: auth(lab), data: { reason: 'Attached to the wrong patient.' } })).status()).toBe(200);
      const email = await ctx.post(`${API}/results/${line.id}/email`, { headers: auth(lab) });
      expect(ok(email.status()), `email after withdraw answered ${email.status()}`).toBe(false);
      expect(email.status()).toBeLessThan(500);
      expect((await ctx.post(`${API}/results/${line.id}`, { headers: auth(lab), multipart: { file: reportPart('right') } })).status()).toBeLessThan(300);
      expect((await ctx.post(`${API}/results/${line.id}/release`, { headers: auth(lab) })).status()).toBe(200);
    });

    test('no report on a test nobody has paid for', async () => {
      const { visit } = await walkIn([labTests[2].id]);
      const [line] = await linesOf(visit.id);
      const res = await ctx.post(`${API}/results/${line.id}`, { headers: auth(lab), multipart: { file: reportPart('lab') } });
      expect(ok(res.status()), `answered ${res.status()}`).toBe(false);
      expect(res.status()).toBeLessThan(500);
    });

    test('a booking checked in is not moved, and a refund is not given twice', async () => {
      const c = await client();
      const a = await appt(await book(c, nthWorkingDay(239), '09:00'));
      expect((await checkIn(a.id)).status()).toBe(200);
      const moved = await move(c.token, a.id, nthWorkingDay(240), '10:00');
      expect(moved.status(), 'moving a checked-in booking').toBe(409);

      const { visit } = await walkIn([usTests[0].id]);
      expect((await pay(visit.id)).status()).toBe(201);
      const payment = (await (await ctx.get(`${API}/payments/visit/${visit.id}`, { headers: auth(till) })).json()).data.payments[0];
      const body = { kind: 'recorded_by_mistake', reason: 'Taken on the wrong visit.', returnedVia: 'Cash' };
      expect(ok((await ctx.post(`${API}/payments/${payment.id}/refund`, { headers: auth(superAdmin), data: body })).status())).toBe(true);
      const again = await ctx.post(`${API}/payments/${payment.id}/refund`, { headers: auth(superAdmin), data: body });
      expect(again.status(), 'a second refund of the same receipt').toBe(409);
    });

    test('a paid visit refuses a discount, a test change and a proof', async () => {
      const c = await client();
      const a = await appt(await book(c, nthWorkingDay(241), '10:30'));
      expect((await pay(a.patient_visit_id)).status()).toBe(201);
      const { discounts } = (await (await ctx.get(`${API}/discounts`, { headers: auth(till) })).json()).data;
      const pwd = discounts.find((d) => /pwd/i.test(d.name));
      expect((await ctx.post(`${API}/discounts/visit/${a.patient_visit_id}`, { headers: auth(till), data: { discountTypeId: pwd.id, idNumber: 'PWD-1' } })).status()).toBe(409);
      expect((await ctx.post(`${API}/tests/visit-tests`, { headers: auth(desk), data: { patientVisitId: a.patient_visit_id, testIds: [usTests[3].id] } })).status()).toBe(409);
      const proof = await submitProof(ctx, c.token, a.patient_visit_id, { amount: 1, reference: `P${Date.now()}`, methodId: method.id });
      expect(proof.status(), 'a proof for a visit already paid').toBe(409);
    });
  });

  // ════ Pass 4. Input ═════════════════════════════════════════════════════════════════════════

  test.describe('4. odd input', () => {
    test('the same test twice on one visit is one line, billed once', async () => {
      const { visit } = await walkIn([usTests[0].id, usTests[0].id]);
      const lines = await linesOf(visit.id);
      expect(lines).toHaveLength(1);
      expect(Number((await billOf(visit.id)).totalAmount)).toBeCloseTo(Number(usTests[0].price), 2);
    });

    test('a payment of the wrong, negative or garbled amount is refused in words', async () => {
      const { visit } = await walkIn([usTests[0].id]);
      for (const amount of [-1, 0, '190abc', 1e12, null]) {
        const res = await ctx.post(`${API}/payments`, { headers: auth(till), data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount } });
        expect(res.status(), `amount ${amount}`).toBe(400);
      }
      for (const m of ['Bitcoin', '', null]) {
        const res = await ctx.post(`${API}/payments`, { headers: auth(till), data: { patientVisitId: visit.id, paymentMethod: m, amount: 1 } });
        expect(res.status(), `method ${m}`).toBe(400);
      }
    });

    test('bad ids, dates, lists and very long text never answer 500', async () => {
      const c = await client();
      const tries = [
        ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: 'abc', visitType: 'Walk in', testIds: [usTests[0].id] } }),
        ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: c.patient.id, visitType: 'Walk in', testIds: 'all' } }),
        ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: c.patient.id, visitType: 'Walk in', testIds: [-4, 0] } }),
        ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: c.patient.id, visitType: 'Teleport', testIds: [usTests[0].id] } }),
        book(c, '2026-02-30', '09:00'),
        book(c, 'next tuesday', '09:00'),
        book(c, nthWorkingDay(242), '25:00'),
        ctx.post(`${API}/patients`, { headers: auth(desk), data: { patientTypeId: 1, firstName: 'A'.repeat(5000), lastName: 'B', birthdate: '1990-01-01', sex: 'Male' } }),
        ctx.post(`${API}/patients`, { headers: auth(desk), data: { patientTypeId: 1, firstName: 'Ana', lastName: 'Cruz', birthdate: '3000-01-01', sex: 'Male' } }),
        ctx.post(`${API}/patients`, { headers: auth(desk), data: { patientTypeId: 1, firstName: 'Ana', lastName: 'Cruz', birthdate: '1990-01-01', sex: 'Robot' } }),
        ctx.post(`${API}/discounts/visit/1`, { headers: auth(till), data: { discountTypeId: 'pwd', idNumber: 'X'.repeat(10000) } }),
        ctx.post(`${API}/cash-counts`, { headers: auth(till), data: { changeFund: -500, pieces: { 1000: -2 } } }),
        ctx.put(`${API}/appointments/abc/reschedule`, { headers: auth(c.token), data: { scheduledDate: '2027-01-01', scheduledTime: '09:00' } }),
        ctx.post(`${API}/hmo/request`, { headers: auth(desk), data: { hmoProviderId: 'x', memberNumber: '', visitTestIds: 'all' } }),
      ];
      const codes = (await Promise.all(tries)).map((r) => r.status());
      codes.forEach((s, i) => expect(s, `try ${i + 1} answered ${s}`).toBeLessThan(500));
      codes.forEach((s, i) => expect(ok(s), `try ${i + 1} was accepted`).toBe(false));

      // A list asked for a negative page and a million rows answers its first page, capped.
      const listed = await ctx.get(`${API}/visits/history`, { headers: auth(desk), params: { startDate: '2026-01-01', endDate: '2026-12-31', page: '-3', limit: '999999' } });
      expect(listed.status()).toBeLessThan(500);
      if (ok(listed.status())) {
        const d = (await listed.json()).data;
        expect((d.visits || d.rows || []).length, 'never more than a page').toBeLessThanOrEqual(100);
      }
    });

    test('a name in Filipino spelling, with ñ and an apostrophe, is stored as typed', async () => {
      const res = await ctx.post(`${API}/patients`, {
        headers: auth(desk),
        data: {
          patientTypeId: await patientTypeId(ctx, API, desk), firstName: 'Niño Joséf', lastName: "Dela Peña-O'Brien",
          birthdate: '1990-01-01', sex: 'Male', contactNumber: FIXTURE_CONTACT,
        },
      });
      expect(res.status(), await res.text()).toBe(201);
      const p = (await res.json()).data.patient;
      expect(p.first_name).toBe('Niño Joséf');
      expect(p.last_name).toBe("Dela Peña-O'Brien");
    });
  });
});
