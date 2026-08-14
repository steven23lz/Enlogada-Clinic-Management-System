/**
 * Seeds a small, realistic clinic day: five patients, one at each stage of the workflow.
 *
 * Built for demonstrating and manually exercising the system after `resetDemoData.js`. Five is
 * deliberate — enough that every console has something to show, few enough that each screen still
 * reads at a glance and you can follow a single patient end to end without searching.
 *
 * Everything goes through the real HTTP API rather than direct inserts, so queue numbers, receipt
 * numbers, ticket-release gating and status transitions are all produced by the same code paths a
 * real visit uses. Seeding straight into the tables would create rows the application itself
 * could never have produced, which is precisely the kind of test data that makes a demo lie.
 *
 * Requires both dev servers running.
 *   node src/scripts/seedDemoScenario.js
 */
const env = require('../config/environment');
const logger = require('../config/logger');

const API = process.env.E2E_API_URL ? `${process.env.E2E_API_URL}/api` : 'http://localhost:5000/api';
const PASSWORD = 'Password123!';

const STAFF = {
  receptionist: 'receptionist@enlogada.com',
  cashier: 'cashier@enlogada.com',
  lab: 'lab@enlogada.com',
};

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json.message || text.slice(0, 120)}`);
  return json;
}

const login = async (email) => (await call('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).data.token;

async function registerWalkIn(recToken, firstName, lastName) {
  const patient = (await call('/patients', {
    method: 'POST', token: recToken,
    body: {
      patientTypeId: 3, firstName, lastName, birthdate: '1990-05-14', sex: 'Female',
      address: 'Cagayan de Oro', contactNumber: '09170000000', emergencyContact: '09171111111',
    },
  })).data.patient;

  const visit = (await call('/visits', {
    method: 'POST', token: recToken,
    body: { patientId: patient.id, visitType: 'Walk in', notes: 'Demo scenario' },
  })).data.visit;

  return { patient, visit };
}

async function attachTest(recToken, visitId, categoryName, tests) {
  const chosen = tests.find((t) => t.category_name === categoryName);
  await call('/tests/visit-tests', {
    method: 'POST', token: recToken,
    body: { patientVisitId: visitId, testIds: [chosen.id] },
  });
  return chosen;
}

async function payVisit(cashierToken, visitId) {
  const bill = (await call(`/payments/bill/${visitId}`, { token: cashierToken })).data.bill;
  return (await call('/payments', {
    method: 'POST', token: cashierToken,
    body: { patientVisitId: visitId, paymentMethod: 'Cash', amount: parseFloat(bill.totalAmount) },
  })).data.payment;
}

async function main() {
  logger.info(`Seeding demo scenario against ${API}`);

  const recToken = await login(STAFF.receptionist);
  const cashierToken = await login(STAFF.cashier);
  const labToken = await login(STAFF.lab);
  const tests = (await call('/tests')).data.tests;

  // 1. Awaiting payment — sits in the Cashier's billing queue.
  const a = await registerWalkIn(recToken, 'Maria', 'Delacruz');
  await attachTest(recToken, a.visit.id, 'Laboratory', tests);
  logger.info(`  1. ${a.patient.first_name} ${a.patient.last_name} — awaiting payment (billing queue)`);

  // 2. Paid and released — appears on the Laboratory worklist as Processing.
  const b = await registerWalkIn(recToken, 'Jose', 'Ramirez');
  await attachTest(recToken, b.visit.id, 'Laboratory', tests);
  await payVisit(cashierToken, b.visit.id);
  logger.info(`  2. ${b.patient.first_name} ${b.patient.last_name} — paid, released to Laboratory`);

  // 3. Findings recorded but not released — parks in Waiting for Release.
  const c = await registerWalkIn(recToken, 'Ana', 'Bautista');
  await attachTest(recToken, c.visit.id, 'Laboratory', tests);
  await payVisit(cashierToken, c.visit.id);
  const cVisitTests = (await call(`/results/pending/Laboratory`, { token: labToken })).data.pending
    .filter((p) => p.last_name === 'Bautista');
  if (cVisitTests.length) {
    await call(`/results/${cVisitTests[0].visit_test_id}`, {
      method: 'POST', token: labToken,
      body: { findings: 'Hemoglobin 13.2 g/dL. White cell count within reference range.', remarks: '', fileUrl: null },
    });
    logger.info(`  3. ${c.patient.first_name} ${c.patient.last_name} — findings recorded, awaiting release`);
  }

  // 4. Completed — a released result, so history and reports have real content.
  const d = await registerWalkIn(recToken, 'Ramon', 'Villanueva');
  await attachTest(recToken, d.visit.id, 'Xray', tests);
  await payVisit(cashierToken, d.visit.id);
  const xrayToken = await login('xray@enlogada.com');
  const dPending = (await call('/results/pending/Xray', { token: xrayToken })).data.pending
    .filter((p) => p.last_name === 'Villanueva');
  if (dPending.length) {
    const vtId = dPending[0].visit_test_id;
    await call(`/results/${vtId}`, {
      method: 'POST', token: xrayToken,
      body: { findings: 'CHEST X-RAY PA VIEW: Clear lung fields. Normal cardiac silhouette.', remarks: '', fileUrl: null },
    });
    await call(`/results/${vtId}/release`, { method: 'POST', token: xrayToken });
    logger.info(`  4. ${d.patient.first_name} ${d.patient.last_name} — X-ray result released (completed)`);
  }

  // 5. An upcoming paid appointment for the seeded client, so the client portal has a booking
  //    pass with a live QR code to show.
  const clientToken = await login('client@enlogada.com');
  const profiles = (await call('/patients/my-profiles', { token: clientToken })).data.patients;
  if (profiles.length) {
    let slot = null;
    for (let i = 1; i <= 14 && !slot; i++) {
      const dt = new Date(); dt.setDate(dt.getDate() + i);
      const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const av = (await call(`/appointments/availability?date=${ds}`, { token: clientToken })).data;
      if (av.isOpen) {
        const free = av.slots.find((s) => s.available);
        if (free) slot = { scheduledDate: ds, scheduledTime: free.time };
      }
    }
    if (slot) {
      const appt = (await call('/appointments', {
        method: 'POST', token: clientToken,
        body: { patientId: profiles[0].id, ...slot, notes: 'Demo booking' },
      })).data.appointment;
      await attachTest(clientToken, appt.patient_visit_id, 'Ultrasound', tests);
      await payVisit(cashierToken, appt.patient_visit_id);
      logger.info(`  5. Elena Client — paid appointment on ${slot.scheduledDate} ${slot.scheduledTime} (booking pass w/ QR)`);
    }
  }

  logger.info('Demo scenario seeded. Frontend: ' + env.FRONTEND_URL);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Seeding failed: ${err.message}`);
  logger.error('Both dev servers must be running, and seeded accounts must exist (node src/scripts/seedUsers.js).');
  process.exit(1);
});
