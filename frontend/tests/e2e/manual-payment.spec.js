// @ts-check
import { test, expect, request } from 'playwright/test';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';

/**
 * Paying into the clinic's own account, verified by hand. [1.48.0]
 *
 * The clinic takes online payment without a gateway: SuperAdmin publishes its GCash/bank details,
 * the patient pays and uploads a screenshot with the reference, and a cashier checks it. Only then
 * is the booking pass issued.
 *
 * Four properties are worth a test, and they are all about money rather than about screens:
 *
 *  * Publishing an account number is SuperAdmin ONLY. It is where a patient's money is sent, and a
 *    wrong number redirects real payments with no error anywhere — so this is not delegable, and
 *    not even Admin may do it.
 *  * The claimed amount is EVIDENCE, never an instruction. Approval bills the recomputed visit
 *    total, so a patient typing 50 on a 1,450 visit cannot produce a 50 payment even if a cashier
 *    approves it.
 *  * Approval runs the real payment path — a genuine receipt number, the visit released.
 *  * One live claim per visit, so two cashiers cannot take the same money twice.
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;

const SUPERADMIN = { email: 'admin@enlogada.com', password: 'Password123!' };
const ADMIN = { email: 'clinicadmin@enlogada.com', password: 'Password123!' };
const CASHIER = { email: 'cashier@enlogada.com', password: 'Password123!' };
const RECEPTIONIST = { email: 'receptionist@enlogada.com', password: 'Password123!' };

// A 1x1 PNG. The smallest thing that is genuinely an image, so the mime check is exercised
// without carrying a fixture file around.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

async function loginAs(api, creds) {
  const res = await api.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

/** A walk-in carrying a real bill, so there is something to pay. */
async function billedVisit(api, token) {
  const H = { Authorization: `Bearer ${token}` };
  const types = (await (await api.get(`${API}/patients/types`, { headers: H })).json()).data.patientTypes;
  const selfPay = types.find((t) => t.name === 'Self Pay');

  const patient = (await (await api.post(`${API}/patients`, {
    headers: H,
    data: {
      ...fixturePerson(), birthdate: '1990-01-01', sex: 'Female',
      address: 'Bugo, Cagayan de Oro City', contactNumber: FIXTURE_CONTACT,
      patientTypeId: selfPay.id,
    },
  })).json()).data.patient;

  const visit = (await (await api.post(`${API}/visits`, {
    headers: H, data: { patientId: patient.id, visitType: 'Walk in', notes: 'e2e manual payment' },
  })).json()).data.visit;

  const packages = (await (await api.get(`${API}/packages`)).json()).data.packages;
  await api.post(`${API}/tests/visit-tests`, {
    headers: H, data: { patientVisitId: visit.id, packageIds: [packages[0].id] },
  });

  const bill = (await (await api.get(`${API}/payments/bill/${visit.id}`, {
    headers: { Authorization: `Bearer ${await loginAs(api, CASHIER)}` },
  })).json()).data.bill;

  return { visit, total: Number(bill.totalAmount) };
}

async function submitProof(api, token, visitId, { amount, reference, methodId }) {
  return api.post(`${API}/payment-submissions`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      patientVisitId: String(visitId),
      ...(methodId ? { paymentMethodId: String(methodId) } : {}),
      referenceNumber: reference,
      amountClaimed: String(amount),
      proof: { name: 'receipt.png', mimeType: 'image/png', buffer: PNG },
    },
  });
}

/** A published account to pay into, created once for the file. */
async function ensureMethod(api, superToken) {
  const existing = (await (await api.get(`${API}/payment-methods`)).json()).data.methods;
  if (existing.length) return existing[0];

  const res = await api.post(`${API}/payment-methods`, {
    headers: { Authorization: `Bearer ${superToken}` },
    data: {
      kind: 'GCash', label: 'E2E GCash', accountName: 'Enlogada Clinic',
      accountNumber: '09000000000',
    },
  });
  return (await res.json()).data.method;
}

test.describe('Manual proof of payment', () => {
  test('only SuperAdmin may publish an account number', async () => {
    const api = await request.newContext();
    const tokens = {
      superadmin: await loginAs(api, SUPERADMIN),
      admin: await loginAs(api, ADMIN),
      cashier: await loginAs(api, CASHIER),
      receptionist: await loginAs(api, RECEPTIONIST),
    };

    const body = {
      kind: 'GCash', label: 'E2E Probe', accountName: 'Nobody', accountNumber: '09000000001',
    };

    // Admin is refused too, which is the point: this is not delegable by permission, because the
    // account number is where a patient's money physically goes.
    for (const role of ['admin', 'cashier', 'receptionist']) {
      const res = await api.post(`${API}/payment-methods`, {
        headers: { Authorization: `Bearer ${tokens[role]}` }, data: body,
      });
      expect(res.status(), `${role} must not publish an account`).toBe(403);
    }
    expect((await api.post(`${API}/payment-methods`, { data: body })).status()).toBe(401);

    // And the management list, which exposes retired accounts, is SuperAdmin's alone.
    expect((await api.get(`${API}/payment-methods/manage`, {
      headers: { Authorization: `Bearer ${tokens.admin}` },
    })).status()).toBe(403);
    expect((await api.get(`${API}/payment-methods/manage`, {
      headers: { Authorization: `Bearer ${tokens.superadmin}` },
    })).status()).toBe(200);

    await api.dispose();
  });

  test('a patient pays, a cashier verifies, and a real receipt is issued', async () => {
    const api = await request.newContext();
    const superToken = await loginAs(api, SUPERADMIN);
    const recToken = await loginAs(api, RECEPTIONIST);
    const cashToken = await loginAs(api, CASHIER);

    const method = await ensureMethod(api, superToken);
    const { visit, total } = await billedVisit(api, recToken);

    const reference = `E2E-${Date.now()}`;
    const sub = await submitProof(api, recToken, visit.id, {
      amount: total, reference, methodId: method.id,
    });
    expect(sub.status()).toBe(201);
    const submission = (await sub.json()).data.submission;

    // One live claim per visit: a second would let two cashiers take the same money twice.
    const dupe = await submitProof(api, recToken, visit.id, {
      amount: total, reference: `${reference}-again`, methodId: method.id,
    });
    expect(dupe.status()).toBe(409);

    // The cashier's queue carries what the visit owes beside what the patient claims.
    const queue = (await (await api.get(`${API}/payment-submissions/pending`, {
      headers: { Authorization: `Bearer ${cashToken}` },
    })).json()).data.submissions;
    const mine = queue.find((q) => q.id === submission.id);
    expect(mine, 'the claim must reach the cashier queue').toBeTruthy();
    expect(Number(mine.amount_due)).toBeCloseTo(total, 2);

    // The screenshot is a patient's banking screen: staff may read it, nobody else may.
    expect((await api.get(`${API}/payment-submissions/${submission.id}/proof`)).status()).toBe(401);
    expect((await api.get(`${API}/payment-submissions/${submission.id}/proof`, {
      headers: { Authorization: `Bearer ${cashToken}` },
    })).status()).toBe(200);

    const verified = await api.post(`${API}/payment-submissions/${submission.id}/verify`, {
      headers: { Authorization: `Bearer ${cashToken}` },
    });
    expect(verified.status()).toBe(200);
    const payment = (await verified.json()).data.payment;

    // A real payment, not a bookkeeping entry: a receipt number from daily_counters, and the
    // amount settled in the cash-up bucket the method declared.
    expect(payment.receipt_number, 'approval must issue a real receipt').toBeTruthy();
    expect(payment.payment_method).toBe(method.kind);
    expect(Number(payment.amount)).toBeCloseTo(total, 2);

    // Approving twice must not take the money twice.
    expect((await api.post(`${API}/payment-submissions/${submission.id}/verify`, {
      headers: { Authorization: `Bearer ${cashToken}` },
    })).status()).toBe(409);

    await api.dispose();
  });

  test('what the patient claims cannot set what they are charged', async () => {
    const api = await request.newContext();
    const superToken = await loginAs(api, SUPERADMIN);
    const recToken = await loginAs(api, RECEPTIONIST);
    const cashToken = await loginAs(api, CASHIER);

    const method = await ensureMethod(api, superToken);
    const { visit, total } = await billedVisit(api, recToken);

    // A tenth of the real bill.
    const understated = Math.round(total / 10);
    const sub = await submitProof(api, recToken, visit.id, {
      amount: understated, reference: `E2E-LOW-${Date.now()}`, methodId: method.id,
    });
    const submission = (await sub.json()).data.submission;
    expect(Number(submission.amount_claimed)).toBeCloseTo(understated, 2);

    const verified = await api.post(`${API}/payment-submissions/${submission.id}/verify`, {
      headers: { Authorization: `Bearer ${cashToken}` },
    });
    expect(verified.status()).toBe(200);

    // The whole point: the ledger records the BILL, never the claim. If this ever inverted, a
    // patient could set their own price by typing it, and every downstream total would agree
    // with them.
    const payment = (await verified.json()).data.payment;
    expect(Number(payment.amount)).toBeCloseTo(total, 2);
    expect(Number(payment.amount)).not.toBeCloseTo(understated, 2);

    await api.dispose();
  });

  test('a rejection has to say why, and the patient is told', async () => {
    const api = await request.newContext();
    const superToken = await loginAs(api, SUPERADMIN);
    const recToken = await loginAs(api, RECEPTIONIST);
    const cashToken = await loginAs(api, CASHIER);

    const method = await ensureMethod(api, superToken);
    const { visit, total } = await billedVisit(api, recToken);
    const sub = await submitProof(api, recToken, visit.id, {
      amount: total, reference: `E2E-REJ-${Date.now()}`, methodId: method.id,
    });
    const submission = (await sub.json()).data.submission;

    // A refusal with no reason leaves whoever answers the phone with nothing to say — the same
    // rule [1.27.0] applies to an HMO refusal.
    const bare = await api.post(`${API}/payment-submissions/${submission.id}/reject`, {
      headers: { Authorization: `Bearer ${cashToken}` }, data: {},
    });
    expect(bare.status()).toBe(400);

    const reason = 'The screenshot shows a different amount.';
    const rejected = await api.post(`${API}/payment-submissions/${submission.id}/reject`, {
      headers: { Authorization: `Bearer ${cashToken}` }, data: { reviewNote: reason },
    });
    expect(rejected.status()).toBe(200);

    // The visit is still unpaid, and the patient can see why so they can fix it and resubmit.
    const bill = (await (await api.get(`${API}/payments/bill/${visit.id}`, {
      headers: { Authorization: `Bearer ${cashToken}` },
    })).json()).data.bill;
    expect(Number(bill.totalAmount)).toBeCloseTo(total, 2);

    const mine = (await (await api.get(`${API}/payment-submissions/visit/${visit.id}`, {
      headers: { Authorization: `Bearer ${recToken}` },
    })).json()).data.submissions;
    expect(mine[0].status).toBe('Rejected');
    expect(mine[0].review_note).toBe(reason);

    // Rejected is not final: the whole reason for a reason is that they can try again.
    const retry = await submitProof(api, recToken, visit.id, {
      amount: total, reference: `E2E-RETRY-${Date.now()}`, methodId: method.id,
    });
    expect(retry.status(), 'a rejection must not lock the patient out').toBe(201);

    await api.dispose();
  });
});
