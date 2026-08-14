// @ts-check
import { test, expect, request } from 'playwright/test';

// Result versioning and critical-value flagging.
//
// Two clinical-safety failures that shared one table:
//
//   Correcting a released result used to OVERWRITE it. test_results carried
//   UNIQUE(visit_test_id) and the write was an ON CONFLICT DO UPDATE, so a radiology report
//   already issued to a patient could be silently rewritten with nothing recording what it used
//   to say. The audit entry noted only that a correction happened.
//
//   A panic value released with the same silent "your results are ready" email as a routine CBC.
//
// The assertions below are the ones that must never regress: the original text survives, exactly
// one version is live, lists do not repeat a row per version, and a critical result escalates.

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';

test.describe('Result versioning and critical values', () => {
  let apiContext;
  let lab, reception, admin;
  let visitTestId;

  const login = async (email) => {
    const res = await apiContext.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).data.token;
  };
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  // Findings go up as multipart because the route carries multer for the optional file field.
  const record = async (token, fields) => {
    const res = await apiContext.post(`${API}/results/${visitTestId}`, {
      headers: auth(token),
      multipart: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])),
    });
    return { status: res.status(), body: await res.json() };
  };

  test.beforeAll(async () => {
    apiContext = await request.newContext();
    lab = await login('lab@enlogada.com');
    reception = await login('receptionist@enlogada.com');
    admin = await login('admin@enlogada.com');
    const cashier = await login('cashier@enlogada.com');

    // Builds its own ticket rather than borrowing one from the demo seed. These tests release and
    // amend whatever they touch, so reusing a seeded ticket would quietly consume the "paid,
    // released to Laboratory" demo stage on every run — the suite is supposed to leave the
    // demo dataset exactly as it found it.
    const types = (await (await apiContext.get(`${API}/patients/types`, { headers: auth(reception) })).json())
      .data.patientTypes;
    const priv = types.find((t) => /private/i.test(t.name)) || types[0];

    const patient = await (await apiContext.post(`${API}/patients`, {
      headers: auth(reception),
      data: {
        patientTypeId: priv.id, firstName: 'E2E', lastName: 'VersionProbe',
        birthdate: '1985-06-15', sex: 'Male',
      },
    })).json();

    const visit = await (await apiContext.post(`${API}/visits`, {
      headers: auth(reception),
      data: { patientId: patient.data.patient.id, visitType: 'Walk in', notes: 'e2e versioning' },
    })).json();
    const visitId = visit.data.visit.id;

    const tests = (await (await apiContext.get(`${API}/tests`)).json()).data.tests;
    const labTest = tests.find((t) => t.category_name === 'Laboratory' && parseFloat(t.price) > 0);
    const attached = await (await apiContext.post(`${API}/tests/visit-tests`, {
      headers: auth(reception),
      data: { patientVisitId: visitId, testIds: [labTest.id] },
    })).json();
    visitTestId = attached.data.visitTests[0].id;

    // Paying releases a walk-in straight to the modalities — that is the gate the worklist is
    // behind, and findings cannot be recorded until it opens.
    const bill = (await (await apiContext.get(`${API}/payments/bill/${visitId}`, { headers: auth(cashier) })).json())
      .data.bill;
    const paid = await apiContext.post(`${API}/payments`, {
      headers: auth(cashier),
      data: { patientVisitId: visitId, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
    });
    expect(paid.status(), 'the ticket must be released before findings can be recorded').toBe(201);
  });

  test.afterAll(async () => {
    await apiContext.dispose();
  });

  test('an amendment supersedes rather than overwrites, and the original survives', async () => {
    const v1 = await record(lab, { findings: 'Haemoglobin 13.2 g/dL. Within normal limits.', remarks: 'Routine' });
    expect(v1.status).toBe(201);

    const v2 = await record(lab, {
      findings: 'Haemoglobin 8.1 g/dL. Low.',
      remarks: 'Repeat confirms',
      amendmentReason: 'Transcription error in original report',
    });
    expect(v2.status).toBe(201);
    expect(v2.body.data.result.version).toBe(v1.body.data.result.version + 1);

    const versions = (await (await apiContext.get(`${API}/results/${visitTestId}/versions`, { headers: auth(lab) })).json())
      .data.versions;

    // The whole point: the superseded text is still readable.
    const original = versions.find((v) => v.version === v1.body.data.result.version);
    expect(original, 'the original version must still exist').toBeTruthy();
    expect(original.findings).toContain('13.2');
    expect(original.is_current).toBe(false);

    // And the chain is walkable forwards.
    expect(original.superseded_by).toBe(v2.body.data.result.id);
    expect(versions.find((v) => v.is_current).amendment_reason).toBe('Transcription error in original report');
  });

  test('exactly one version is live, and lists never repeat a row per version', async () => {
    const versions = (await (await apiContext.get(`${API}/results/${visitTestId}/versions`, { headers: auth(lab) })).json())
      .data.versions;
    expect(versions.length).toBeGreaterThan(1);
    expect(versions.filter((v) => v.is_current)).toHaveLength(1);

    // The live read returns the newest, not an arbitrary version.
    const current = (await (await apiContext.get(`${API}/results/${visitTestId}`, { headers: auth(lab) })).json())
      .data.result;
    expect(current.version).toBe(Math.max(...versions.map((v) => v.version)));

    // The regression that versioning most easily introduces: a LEFT JOIN without an is_current
    // filter repeats the ticket once per amendment and shows superseded findings as live.
    const released = (await (await apiContext.get(`${API}/results/released/Laboratory`, { headers: auth(lab) })).json())
      .data.released;
    expect(released.filter((r) => r.visit_test_id === visitTestId).length).toBeLessThanOrEqual(1);
  });

  test('a critical result escalates and can be acknowledged exactly once', async () => {
    const critical = await record(lab, {
      findings: 'Potassium 7.4 mmol/L. CRITICALLY HIGH.',
      remarks: 'Urgent',
      amendmentReason: 'Repeat sample confirms critical value',
      isCritical: 'true',
    });
    expect(critical.status).toBe(201);
    expect(critical.body.data.result.is_critical).toBe(true);

    const release = await apiContext.post(`${API}/results/${visitTestId}/release`, { headers: auth(lab) });
    expect(release.status()).toBe(200);
    expect((await release.json()).data.result.isCritical).toBe(true);

    // Reception is included on purpose: the front desk usually makes the call, and a callback
    // that cannot be recorded by whoever made it does not get recorded.
    const ack = await apiContext.post(`${API}/results/${visitTestId}/acknowledge-critical`, {
      headers: auth(reception),
      data: { note: 'Phoned patient 14:20, spoke to Dr Reyes' },
    });
    expect(ack.status()).toBe(200);

    // Acknowledging twice would make the callback record ambiguous about when contact happened.
    const again = await apiContext.post(`${API}/results/${visitTestId}/acknowledge-critical`, {
      headers: auth(reception),
      data: { note: 'duplicate' },
    });
    expect(again.status()).toBe(409);
  });

  test('the escalation reaches staff as a critical-severity notification', async () => {
    const res = await apiContext.get(`${API}/notifications`, { headers: auth(admin) });
    expect(res.status()).toBe(200);
    const notifications = (await res.json()).data.notifications;

    const alert = notifications.find((n) => /CRITICAL RESULT/i.test(n.title));
    expect(alert, 'a critical release must raise a notification').toBeTruthy();
    // Severity matters as much as the message: notification_events.type was CHECKed to
    // ('info','success','warning') and the service silently downgrades anything else, so this
    // escalation arrived looking exactly like "New Appointment Booked" until 'critical' existed.
    expect(alert.type).toBe('critical');
  });

  test('the amendment history is department-scoped like every other result read', async () => {
    // Xray staff have no business reading a Laboratory result's history.
    const xray = await login('xray@enlogada.com');
    const res = await apiContext.get(`${API}/results/${visitTestId}/versions`, { headers: auth(xray) });
    expect(res.status()).toBe(403);
  });
});
