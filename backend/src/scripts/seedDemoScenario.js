/**
 * Seeds a realistic clinic dataset — enough for every role to have real work on screen, and
 * enough history behind it that the reporting screens have something to plot.
 *
 * Built for demonstrating and manually exercising the system after `resetDemoData.js`.
 *
 * Two passes, for a reason:
 *
 *   TODAY goes through the real HTTP API. Queue numbers, receipt numbers, ticket-release gating,
 *   discount arithmetic and status transitions are all produced by the same code paths a real
 *   visit uses. Seeding straight into the tables would create rows the application itself could
 *   never have produced, which is exactly the kind of test data that makes a demo lie.
 *
 *   HISTORY is created the same way and then BACKDATED with a direct UPDATE, because the API
 *   always stamps the current time and there is no legitimate endpoint that says "this happened
 *   last Tuesday". Without history the revenue trend, the staff-workload report and the
 *   date-range screens are all empty, which makes them look broken rather than new.
 *
 * Why this matters day to day: every "today" screen — the active queue, today's collections, the
 * modality worklists — filters on the current date. Seed on Monday and demo on Tuesday and they
 * are all legitimately empty. Re-run this before a demo; it is idempotent in the sense that it
 * only ever adds, so pair it with `resetDemoData.js --confirm` for a clean slate.
 *
 * Requires both dev servers running.
 *   node src/scripts/seedDemoScenario.js
 */
const db = require('../config/database');
const logger = require('../config/logger');

const API = process.env.E2E_API_URL ? `${process.env.E2E_API_URL}/api` : 'http://localhost:5000/api';
const PASSWORD = 'Password123!';

const STAFF = {
  receptionist: 'receptionist@enlogada.com',
  cashier: 'cashier@enlogada.com',
  lab: 'lab@enlogada.com',
  xray: 'xray@enlogada.com',
  ultrasound: 'ultrasound@enlogada.com',
  admin: 'admin@enlogada.com',
};

// Filipino names, because a demo full of "Test Patient 1" tells you nothing about how the screens
// read with real data — column widths, truncation and sort order all behave differently.
const PEOPLE = [
  ['Maria', 'Delacruz', 'Female', '1958-03-12'], ['Jose', 'Ramirez', 'Male', '1972-07-04'],
  ['Ana', 'Bautista', 'Female', '1990-11-23'],   ['Ramon', 'Villanueva', 'Male', '1965-01-30'],
  ['Liwayway', 'Manalo', 'Female', '1948-09-17'],['Andres', 'Bonifacio', 'Male', '1983-05-08'],
  ['Corazon', 'Aquino', 'Female', '1954-01-25'], ['Emilio', 'Aguinaldo', 'Male', '1995-03-22'],
  ['Josefa', 'Llanes', 'Female', '1961-12-02'],  ['Apolinario', 'Mabini', 'Male', '1977-06-14'],
  ['Gabriela', 'Silang', 'Female', '1988-08-19'],['Melchora', 'Aquino', 'Female', '1943-04-06'],
  ['Diego', 'Silang', 'Male', '1969-10-11'],     ['Teresa', 'Magbanua', 'Female', '1992-02-28'],
  ['Marcelo', 'Del Pilar', 'Male', '1956-11-05'],['Trinidad', 'Tecson', 'Female', '1975-07-21'],
  ['Juan', 'Luna', 'Male', '1986-09-13'],        ['Gregoria', 'De Jesus', 'Female', '1951-05-09'],
  ['Antonio', 'Luna', 'Male', '1980-01-18'],     ['Leona', 'Florentino', 'Female', '1997-04-27'],
];

const call = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json.message || text.slice(0, 140)}`);
  return json;
};

const login = async (email) =>
  (await call('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).data.token;

const pick = (arr, i) => arr[i % arr.length];

async function main() {
  logger.info(`Seeding demo data against ${API}`);

  const tok = {};
  for (const [key, email] of Object.entries(STAFF)) tok[key] = await login(email);

  const types = (await call('/patients/types', { token: tok.receptionist })).data.patientTypes;
  const typeId = (name) => (types.find((t) => new RegExp(name, 'i').test(t.name)) || types[0]).id;

  const tests = (await call('/tests')).data.tests;
  const byCategory = (cat) => tests.filter((t) => t.category_name === cat && parseFloat(t.price) > 0);
  const catalogue = {
    Laboratory: byCategory('Laboratory'),
    Xray: byCategory('Xray'),
    Ultrasound: byCategory('Ultrasound'),
    '2D Echo': byCategory('2D Echo'),
    ECG: byCategory('ECG'),
  };

  const discounts = (await call('/discounts', { token: tok.cashier })).data.discounts;
  const senior = discounts.find((d) => d.name === 'Senior Citizen');
  const pwd = discounts.find((d) => d.name === 'PWD');

  const modalityToken = { Laboratory: tok.lab, Xray: tok.xray, Ultrasound: tok.ultrasound, '2D Echo': tok.ultrasound, ECG: tok.admin };

  let personIndex = 0;
  const nextPerson = () => pick(PEOPLE, personIndex++);

  /** Registers a walk-in and attaches one test from `category`. Returns the ids and price. */
  const makeVisit = async ({ category, patientTypeName = 'Private', testIndex = 0 }) => {
    const [firstName, lastName, sex, birthdate] = nextPerson();
    const patient = (await call('/patients', {
      method: 'POST', token: tok.receptionist,
      body: {
        patientTypeId: typeId(patientTypeName), firstName, lastName, birthdate, sex,
        address: 'Sta. Rosa, Laguna', contactNumber: '09170000000', emergencyContact: '09171111111',
      },
    })).data.patient;

    const visit = (await call('/visits', {
      method: 'POST', token: tok.receptionist,
      body: { patientId: patient.id, visitType: 'Walk in', notes: `${category} — walk-in` },
    })).data.visit;

    const test = pick(catalogue[category], testIndex);
    const attached = (await call('/tests/visit-tests', {
      method: 'POST', token: tok.receptionist,
      body: { patientVisitId: visit.id, testIds: [test.id] },
    })).data.visitTests[0];

    return { patient, visit, test, visitTestId: attached.id, category, price: parseFloat(test.price) };
  };

  const payFor = async (v, method = 'Cash') => {
    const bill = (await call(`/payments/bill/${v.visit.id}`, { token: tok.cashier })).data.bill;
    return (await call('/payments', {
      method: 'POST', token: tok.cashier,
      body: { patientVisitId: v.visit.id, paymentMethod: method, amount: parseFloat(bill.totalAmount) },
    })).data.payment;
  };

  const recordFindings = async (v, { findings, isCritical = false }) => {
    const token = modalityToken[v.category];
    const form = new FormData();
    form.append('findings', findings);
    form.append('remarks', 'Clinical correlation recommended.');
    form.append('isCritical', String(isCritical));
    const res = await fetch(`${API}/results/${v.visitTestId}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    if (!res.ok) throw new Error(`record findings -> ${res.status} ${(await res.text()).slice(0, 140)}`);
    return (await res.json()).data.result;
  };

  const release = async (v) =>
    (await call(`/results/${v.visitTestId}/release`, { method: 'POST', token: modalityToken[v.category] })).data.result;

  // ── TODAY: one visit at each stage of the workflow, per department ───────────────────────
  const today = [];
  const stages = [];

  // 1. Awaiting payment — sits in the cashier's billing queue.
  for (const category of ['Laboratory', 'Xray', 'Ultrasound']) {
    const v = await makeVisit({ category });
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — awaiting payment (${category})`);
  }

  // 2. A senior citizen and a PWD awaiting payment, so the statutory discount and its
  //    VAT-exempt arithmetic are visible on the cashier screen rather than hypothetical.
  for (const [d, label] of [[senior, 'Senior Citizen'], [pwd, 'PWD']]) {
    const v = await makeVisit({ category: '2D Echo' });
    await call(`/discounts/visit/${v.visit.id}`, {
      method: 'POST', token: tok.cashier,
      body: { discountTypeId: d.id, idNumber: label === 'PWD' ? 'PWD-2026-0042' : 'OSCA-2026-0117' },
    });
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — awaiting payment, ${label} 20% + VAT-exempt`);
  }

  // 2b. The same two statutory discounts, but SETTLED — otherwise the BIR statutory register is
  //     empty, since it reads from payments rather than from entitlements. An empty register
  //     looks like the feature does not work.
  for (const [d, label, idNumber] of [[senior, 'Senior Citizen', 'OSCA-2026-0093'], [pwd, 'PWD', 'PWD-2026-0117']]) {
    const v = await makeVisit({ category: 'Ultrasound', testIndex: 1 });
    await call(`/discounts/visit/${v.visit.id}`, {
      method: 'POST', token: tok.cashier, body: { discountTypeId: d.id, idNumber },
    });
    const paid = await payFor(v, 'Cash');
    today.push(v);
    stages.push(
      `${v.patient.first_name} ${v.patient.last_name} — ${label} PAID: gross ${v.price.toFixed(2)}, ` +
        `less VAT ${paid.vat_amount}, less 20% ${paid.discount_amount} = ${paid.amount}`
    );
  }

  // 3. Paid and released — live on the modality worklists.
  for (const category of ['Laboratory', 'Xray', 'Ultrasound', 'ECG']) {
    const v = await makeVisit({ category, testIndex: 1 });
    await payFor(v, pick(['Cash', 'GCash', 'PayMaya', 'Bank'], today.length));
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — paid, on the ${category} worklist`);
  }

  // 4. Findings recorded, awaiting authorisation — the 'Waiting for Release' state.
  {
    const v = await makeVisit({ category: 'Laboratory', testIndex: 2 });
    await payFor(v, 'Cash');
    await recordFindings(v, { findings: 'Haemoglobin 13.4 g/dL. White cell count 7.2. Within normal limits.' });
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — findings recorded, awaiting release`);
  }

  // 5. A CRITICAL result, released and awaiting callback — the escalation path.
  {
    const v = await makeVisit({ category: 'Laboratory', testIndex: 3 });
    await payFor(v, 'Cash');
    await recordFindings(v, {
      findings: 'Potassium 7.1 mmol/L. CRITICALLY HIGH — repeat sample confirms. Urgent review required.',
      isCritical: true,
    });
    await release(v);
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — CRITICAL result released, callback outstanding`);
  }

  // 6. An AMENDED result — two versions, so the amendment history has something in it.
  {
    const v = await makeVisit({ category: 'Xray', testIndex: 2 });
    await payFor(v, 'GCash');
    await recordFindings(v, { findings: 'No acute cardiopulmonary findings.' });
    const token = modalityToken[v.category];
    const form = new FormData();
    form.append('findings', 'Minimal left basal atelectasis. No consolidation. Heart size normal.');
    form.append('remarks', 'Corrected on senior radiologist review.');
    form.append('amendmentReason', 'Initial report missed a basal finding on re-review');
    form.append('isCritical', 'false');
    await fetch(`${API}/results/${v.visitTestId}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    await release(v);
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — AMENDED X-ray report (v2), released`);
  }

  // 7. Fully completed — shows in released history and patient records.
  for (const category of ['Ultrasound', 'Laboratory']) {
    const v = await makeVisit({ category, testIndex: 3 });
    await payFor(v, 'Cash');
    await recordFindings(v, { findings: `${category} study completed. No abnormality detected.` });
    await release(v);
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — ${category} completed and released`);
  }

  // 8. An HMO patient with a pending pre-authorisation, for the Service Requests screen.
  {
    const v = await makeVisit({ category: 'Ultrasound', patientTypeName: 'HMO', testIndex: 2 });
    const providers = (await call('/hmo/providers', { token: tok.receptionist })).data.providers;
    await call('/hmo/request', {
      method: 'POST', token: tok.receptionist,
      body: { hmoProviderId: providers[0].id, approvalCode: 'LOA-2026-88213', visitTestIds: [v.visitTestId] },
    });
    today.push(v);
    stages.push(`${v.patient.first_name} ${v.patient.last_name} — HMO pre-auth pending (${providers[0].name})`);
  }

  // ── HISTORY: two weeks of completed, paid visits, then backdated ─────────────────────────
  // Without this the revenue trend, staff workload and every date-range report are empty, which
  // reads as broken rather than new.
  const historical = [];
  const CATEGORIES = ['Laboratory', 'Xray', 'Ultrasound', '2D Echo', 'ECG'];
  for (let daysAgo = 14; daysAgo >= 1; daysAgo--) {
    // Two or three visits a day, varying so the trend line is not a flat bar.
    const perDay = 2 + (daysAgo % 2);
    for (let i = 0; i < perDay; i++) {
      const category = pick(CATEGORIES, daysAgo + i);
      const v = await makeVisit({ category, testIndex: i });
      await payFor(v, pick(['Cash', 'Cash', 'GCash', 'PayMaya', 'Bank'], daysAgo + i));
      await recordFindings(v, { findings: `${category} study. No abnormality detected.` });
      await release(v);
      historical.push({ ...v, daysAgo });
    }
  }

  // Backdate in one transaction. Everything above was created "now" by the API; this is the only
  // step that cannot go through it, because no endpoint legitimately says "this happened last
  // Tuesday" — and rightly so.
  await db.withTransaction(async () => {
    for (const h of historical) {
      const shift = `${h.daysAgo} days`;
      await db.query(
        `UPDATE patient_visits SET created_at = created_at - $2::interval, updated_at = updated_at - $2::interval WHERE id = $1`,
        [h.visit.id, shift]
      );
      await db.query(
        `UPDATE visit_tests SET created_at = created_at - $2::interval WHERE patient_visit_id = $1`,
        [h.visit.id, shift]
      );
      await db.query(
        `UPDATE payments SET paid_at = paid_at - $2::interval WHERE patient_visit_id = $1`,
        [h.visit.id, shift]
      );
      await db.query(
        `UPDATE test_results SET released_at = released_at - $2::interval,
                                 authorised_at = authorised_at - $2::interval
         WHERE visit_test_id = $1`,
        [h.visitTestId, shift]
      );
    }
  });

  // ── Appointments: today, upcoming, and a no-show ─────────────────────────────────────────
  const client = await login('client@enlogada.com');
  const profiles = (await call('/patients/my-profiles', { token: client })).data.patients;
  if (profiles.length > 0) {
    const slotDate = new Date();
    slotDate.setDate(slotDate.getDate() + 2);
    const dateStr = `${slotDate.getFullYear()}-${String(slotDate.getMonth() + 1).padStart(2, '0')}-${String(slotDate.getDate()).padStart(2, '0')}`;
    try {
      const slots = (await call(`/appointments/availability?date=${dateStr}`, { token: client })).data.slots || [];
      if (slots.length > 0) {
        const booking = (await call('/appointments', {
          method: 'POST', token: client,
          body: { patientId: profiles[0].id, scheduledDate: dateStr, scheduledTime: slots[0].time || slots[0], notes: 'Online booking' },
        })).data.appointment;
        const labTest = catalogue.Laboratory[0];
        await call('/tests/visit-tests', {
          method: 'POST', token: client,
          body: { patientVisitId: booking.patient_visit_id, testIds: [labTest.id] },
        });
        stages.push(`${profiles[0].first_name} ${profiles[0].last_name} — online appointment ${dateStr} (QR booking pass)`);
      }
    } catch (err) {
      logger.warn(`  appointment booking skipped: ${err.message}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────────────────
  const counts = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM patient_visits WHERE created_at::date = CURRENT_DATE) AS visits_today,
      (SELECT COUNT(*)::int FROM patient_visits) AS visits_total,
      (SELECT COUNT(*)::int FROM payments WHERE payment_status = 'Paid' AND paid_at::date = CURRENT_DATE) AS paid_today,
      (SELECT COALESCE(SUM(amount),0)::numeric(10,2) FROM payments WHERE payment_status = 'Paid' AND paid_at::date = CURRENT_DATE) AS revenue_today,
      (SELECT COUNT(*)::int FROM test_results WHERE is_current AND is_critical) AS critical,
      (SELECT COUNT(*)::int FROM test_results WHERE version > 1) AS amended
  `);
  const c = counts.rows[0];

  logger.info('');
  logger.info("Today's workflow:");
  for (const line of stages) logger.info(`   • ${line}`);
  logger.info('');
  logger.info(`   visits today        ${c.visits_today}   (${c.visits_total} including 14 days of history)`);
  logger.info(`   paid today          ${c.paid_today}   —  PHP ${c.revenue_today}`);
  logger.info(`   critical results    ${c.critical}   awaiting callback`);
  logger.info(`   amended results     ${c.amended}`);
  logger.info('');
  logger.info('Every "today" screen filters on the current date, so re-run this before a demo.');
  logger.info('Frontend: http://localhost:5173');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Seeding failed: ${err.message}`);
  process.exit(1);
});
