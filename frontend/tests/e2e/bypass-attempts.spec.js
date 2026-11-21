// @ts-check
/**
 * Getting past the screens. [1.173.0]
 *
 * Steven's adviser: the frontend is a library, not a framework, so it can be bypassed. Anything in a
 * browser can be, whatever it is built with, which is why every rule is the server's. This sends
 * what someone skipping the screens would send, and fails on any of it getting through: one patient
 * reaching for another's records, a patient doing staff work or sending fields the screens never
 * send, staff outside their own lane, forged sign-in tokens, and hostile input. Each refusal is
 * paired with the owner's own request succeeding, so a refusal is a refusal and not a bad id.
 * Every route against every role is backend/src/scripts/probeRouteGates.js.
 */
import { test, expect, request } from 'playwright/test';
import crypto from 'crypto';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { appointmentForm, removeUnpaid } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { PNG, ensureMethod } from './helpers/payments.js';
import { reportPart } from './helpers/reportFile.js';

const API = 'http://localhost:5000/api';
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('what the screens refuse, the server refuses to anyone who skips them', async () => {
  test.setTimeout(240000);
  const ctx = await request.newContext();
  const login = async (e) => (await (await ctx.post(`${API}/auth/login`, { data: { email: e, password: PASSWORD } })).json()).data.token;
  const [desk, till, lab, xray, admin, superAdmin] = await Promise.all(
    ['receptionist@enlogada.com', 'multirole@enlogada.com', 'lab@enlogada.com', 'xray@enlogada.com', 'clinicadmin@enlogada.com', 'admin@enlogada.com'].map(login));
  const method = await ensureMethod(ctx, superAdmin);
  const tests = (await (await ctx.get(`${API}/tests`)).json()).data.tests;
  const labTest = tests.find((t) => t.category_name === 'Laboratory' && t.is_active);
  const usTest = tests.find((t) => t.category_name === 'Ultrasound' && t.is_active);

  const newPatient = async () => {
    const person = fixturePerson();
    const email = fixtureEmail(person);
    const { token } = await registerClient(ctx, { ...person, email, password: PASSWORD });
    const patient = (await (await ctx.post(`${API}/patients`, { headers: auth(token), data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1990-01-01', sex: 'Male', contactNumber: FIXTURE_CONTACT } })).json()).data.patient;
    return { email, token, patient, person };
  };
  const A = await newPatient();
  const B = await newPatient();

  // B: a booking with a doctor's request and a proof waiting, and a walk-in with a released report.
  const bAppt = (await (await ctx.post(`${API}/appointments`, { headers: auth(B.token), multipart: appointmentForm({ patientId: B.patient.id, scheduledDate: nthWorkingDay(246), scheduledTime: '13:00', testIds: [usTest.id] }) })).json()).data.appointment;
  const bSub = (await (await ctx.post(`${API}/payment-submissions`, { headers: auth(B.token), multipart: { patientVisitId: String(bAppt.patient_visit_id), paymentMethodId: String(method.id), referenceNumber: `SEC${Date.now()}`, proof: { name: 'p.png', mimeType: 'image/png', buffer: PNG } } })).json()).data;
  const subId = (bSub.submission || bSub).id;
  const bVisit = (await (await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: B.patient.id, visitType: 'Walk in', testIds: [labTest.id] } })).json()).data.visit;
  const bill = (await (await ctx.get(`${API}/payments/bill/${bVisit.id}`, { headers: auth(till) })).json()).data.bill;
  const paid = (await (await ctx.post(`${API}/payments`, { headers: auth(till), data: { patientVisitId: bVisit.id, paymentMethod: 'Cash', amount: Number(bill.totalAmount) } })).json()).data;
  const receipt = (paid.payment || paid).receipt_number;
  const [vt] = (await (await ctx.get(`${API}/tests/visit-tests/${bVisit.id}`, { headers: auth(desk) })).json()).data.visitTests;
  await ctx.post(`${API}/results/${vt.id}`, { headers: auth(lab), multipart: { file: reportPart('lab') } });
  await ctx.post(`${API}/results/${vt.id}/release`, { headers: auth(lab) });

  const findings = [];
  const shouldRefuse = async (label, res) => {
    const s = (await res).status();
    if (s < 400 || s >= 500) findings.push(`${label}: ${s}`);
  };

  // 0. Positive controls: the same requests as B succeed, so a refusal below is a refusal, not a bad id.
  const bh = auth(B.token);
  const controls = {
    'B record': ctx.get(`${API}/patients/${B.patient.id}`, { headers: bh }),
    'B history': ctx.get(`${API}/results/history/${B.patient.id}`, { headers: bh }),
    'B report file': ctx.get(`${API}/results/${vt.id}/file`, { headers: bh }),
    "B doctor's request": ctx.get(`${API}/visits/${bAppt.patient_visit_id}/doctor-request`, { headers: bh }),
    'B proofs': ctx.get(`${API}/payment-submissions/visit/${bAppt.patient_visit_id}`, { headers: bh }),
    'B proof image': ctx.get(`${API}/payment-submissions/${subId}/proof`, { headers: bh }),
    'B receipt': ctx.get(`${API}/payments/receipt/${receipt}`, { headers: bh }),
    'lab opens the lab report': ctx.get(`${API}/results/${vt.id}/file`, { headers: auth(lab) }),
  };
  for (const [label, req] of Object.entries(controls)) {
    const s = (await req).status();
    console.log(`control ${label}: ${s}`);
    if (s >= 300) findings.push(`CONTROL FAILED (probe invalid) ${label}: ${s}`);
  }
  console.log('ids', JSON.stringify({ a: A.patient.id, b: B.patient.id, appt: bAppt.id, visit: bVisit.id, vt: vt.id, subId, receipt }));

  // 1. Patient A reaching for patient B.
  const a = auth(A.token);
  await shouldRefuse('A reads B record', ctx.get(`${API}/patients/${B.patient.id}`, { headers: a }));
  await shouldRefuse('A edits B record', ctx.put(`${API}/patients/${B.patient.id}`, { headers: a, data: { firstName: 'Hacked' } }));
  await shouldRefuse('A reads B result history', ctx.get(`${API}/results/history/${B.patient.id}`, { headers: a }));
  await shouldRefuse('A opens B report file', ctx.get(`${API}/results/${vt.id}/file`, { headers: a }));
  await shouldRefuse('A reads B result', ctx.get(`${API}/results/${vt.id}`, { headers: a }));
  await shouldRefuse('A reads B result versions', ctx.get(`${API}/results/${vt.id}/versions`, { headers: a }));
  await shouldRefuse('A reads B visit', ctx.get(`${API}/visits/${bVisit.id}`, { headers: a }));
  await shouldRefuse('A reads B visits by patient', ctx.get(`${API}/visits/patient/${B.patient.id}`, { headers: a }));
  await shouldRefuse("A opens B doctor's request", ctx.get(`${API}/visits/${bAppt.patient_visit_id}/doctor-request`, { headers: a }));
  await shouldRefuse('A opens B discount ID', ctx.get(`${API}/visits/${bAppt.patient_visit_id}/discount-id`, { headers: a }));
  await shouldRefuse('A lists B proofs', ctx.get(`${API}/payment-submissions/visit/${bAppt.patient_visit_id}`, { headers: a }));
  await shouldRefuse('A opens B proof image', ctx.get(`${API}/payment-submissions/${subId}/proof`, { headers: a }));
  await shouldRefuse('A opens B receipt', ctx.get(`${API}/payments/receipt/${receipt}`, { headers: a }));
  await shouldRefuse('A reads B bill', ctx.get(`${API}/payments/bill/${bVisit.id}`, { headers: a }));
  await shouldRefuse('A reads B payments', ctx.get(`${API}/payments/visit/${bVisit.id}`, { headers: a }));
  await shouldRefuse('A releases B booking', ctx.post(`${API}/appointments/${bAppt.id}/release`, { headers: a }));
  await shouldRefuse('A moves B booking', ctx.put(`${API}/appointments/${bAppt.id}/reschedule`, { headers: a, data: { scheduledDate: nthWorkingDay(247), scheduledTime: '14:00', reason: 'Schedule conflict' } }));
  await shouldRefuse('A books for B', ctx.post(`${API}/appointments`, { headers: a, multipart: appointmentForm({ patientId: B.patient.id, scheduledDate: nthWorkingDay(248), scheduledTime: '14:00', testIds: [usTest.id] }) }));
  await shouldRefuse('A sends a proof on B booking', ctx.post(`${API}/payment-submissions`, { headers: a, multipart: { patientVisitId: String(bAppt.patient_visit_id), paymentMethodId: String(method.id), referenceNumber: `SECA${Date.now()}`, proof: { name: 'p.png', mimeType: 'image/png', buffer: PNG } } }));
  await shouldRefuse('A gives feedback on B visit', ctx.post(`${API}/feedback/visits/${bVisit.id}`, { headers: a, data: { answers: {} } }));
  await shouldRefuse('A reads B portal access', ctx.get(`${API}/patients/${B.patient.id}/portal-access`, { headers: a }));
  const mine = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: a })).json()).data;
  if (JSON.stringify(mine).includes(B.person.lastName)) findings.push('A sees B in my-profiles');
  const myBookings = (await (await ctx.get(`${API}/appointments/my-bookings`, { headers: a })).json()).data.bookings || [];
  if (myBookings.some((x) => x.id === bAppt.id)) findings.push('A sees B booking in my-bookings');

  // 2. A patient doing staff work, or sending fields the screens never send.
  await shouldRefuse('patient checks own booking in', ctx.put(`${API}/appointments/${bAppt.id}/status`, { headers: auth(B.token), data: { status: 'Confirmed' } }));
  await shouldRefuse('patient sets own visit Completed', ctx.put(`${API}/visits/${bVisit.id}/status`, { headers: auth(B.token), data: { status: 'Completed' } }));
  await shouldRefuse('patient uploads a result', ctx.post(`${API}/results/${vt.id}`, { headers: auth(B.token), multipart: { file: reportPart('lab') } }));
  await shouldRefuse('patient verifies own proof', ctx.post(`${API}/payment-submissions/${subId}/verify`, { headers: auth(B.token) }));
  await shouldRefuse('patient takes a payment', ctx.post(`${API}/payments`, { headers: auth(B.token), data: { patientVisitId: bVisit.id, paymentMethod: 'Cash', amount: 1 } }));
  await shouldRefuse('patient applies a discount', ctx.post(`${API}/discounts/visit/${bAppt.patient_visit_id}`, { headers: auth(B.token), data: { discountId: 1 } }));
  await ctx.put(`${API}/patients/${A.patient.id}`, { headers: a, data: { userId: 1, user_id: 1, archived_at: '2020-01-01', patientTypeId: 999 } });
  const stillMine = (await (await ctx.get(`${API}/patients/my-profiles`, { headers: a })).json()).data;
  if (!JSON.stringify(stillMine).includes(A.person.lastName)) findings.push('A lost own record after sending userId (mass assignment)');
  await ctx.put(`${API}/auth/me`, { headers: a, data: { roles: ['SuperAdmin'], role: 'SuperAdmin', permissions: ['rbac:manage'], isActive: true, email: 'taken@example.com' } });
  const relog = await login(A.email);
  const claims = relog ? JSON.parse(Buffer.from(relog.split('.')[1], 'base64url').toString()) : {};
  if (!relog) findings.push('A cannot sign in after PUT /auth/me (email changed by a stray field?)');
  if ((claims.roles || []).some((r) => r !== 'Client')) findings.push(`A gained roles via PUT /auth/me: ${claims.roles}`);
  const cheap = await ctx.post(`${API}/appointments`, { headers: a, multipart: appointmentForm({ patientId: A.patient.id, scheduledDate: nthWorkingDay(249), scheduledTime: '14:00', testIds: [usTest.id], price: '1', amountDue: '1', price_at_time: '1' }) });
  const cheapBody = (await cheap.json()).data;
  if (cheap.status() < 300 && Number(cheapBody.amountDue) !== Number(usTest.price)) findings.push(`A set own price: due ${cheapBody.amountDue} vs ${usTest.price}`);

  // 3. Staff past their own lane.
  await shouldRefuse('X-ray opens a laboratory report', ctx.get(`${API}/results/${vt.id}/file`, { headers: auth(xray) }));
  await shouldRefuse('Admin creates a SuperAdmin', ctx.post(`${API}/admin/staff`, { headers: auth(admin), data: { firstName: 'Ev', lastName: 'Il', email: fixtureEmail(fixturePerson()), password: 'Password123!x', roles: ['SuperAdmin'] } }));
  await shouldRefuse('receptionist changes staff roles', ctx.put(`${API}/admin/staff/1/roles`, { headers: auth(desk), data: { roles: ['SuperAdmin'] } }));
  await shouldRefuse('lab takes a payment', ctx.post(`${API}/payments`, { headers: auth(lab), data: { patientVisitId: bVisit.id, paymentMethod: 'Cash', amount: 1 } }));
  const aWalkIn = (await (await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: A.patient.id, visitType: 'Walk in', testIds: [labTest.id] } })).json()).data.visit;
  const under = await ctx.post(`${API}/payments`, { headers: auth(till), data: { patientVisitId: aWalkIn.id, paymentMethod: 'Cash', amount: 1 } });
  if (under.status() < 300) {
    const p = (await under.json()).data; const amt = Number((p.payment || p).amount);
    const aBill = (await (await ctx.get(`${API}/payments/bill/${aWalkIn.id}`, { headers: auth(till) })).json()).data.bill;
    if (amt < Number(aBill.totalAmount || amt)) findings.push(`cashier underpaid a bill: recorded ${amt}`);
  }

  // 4. Forged tokens.
  const secretless = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ userId: 1, roles: ['SuperAdmin'], permissions: ['rbac:manage'] })}.`;
  await shouldRefuse('alg:none token', ctx.get(`${API}/auth/me`, { headers: auth(secretless) }));
  const [h, , sig] = A.token.split('.');
  const tampered = `${h}.${b64({ ...JSON.parse(Buffer.from(A.token.split('.')[1], 'base64url').toString()), roles: ['SuperAdmin'] })}.${sig}`;
  await shouldRefuse('payload changed, old signature', ctx.get(`${API}/admin/staff`, { headers: auth(tampered) }));
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ userId: 1, roles: ['SuperAdmin'], exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const guessed = `${body}.${crypto.createHmac('sha256', 'secret').update(body).digest('base64url')}`;
  await shouldRefuse('token signed with a guessed secret', ctx.get(`${API}/admin/staff`, { headers: auth(guessed) }));

  // 5. Hostile input.
  const inj = await ctx.get(`${API}/patients/search?q=${encodeURIComponent("' OR '1'='1' --")}`, { headers: auth(desk) });
  if (inj.status() >= 500) findings.push(`search injection: ${inj.status()}`);
  const injBody = await inj.text();
  if (inj.status() < 300 && (JSON.parse(injBody).data?.patients || []).length > 0) findings.push('search with an injection string returned patients');
  const trav = await ctx.get(`${API}/results/${encodeURIComponent('../../../package.json')}/file`, { headers: auth(lab) });
  if (trav.status() < 300 || (await trav.text()).includes('"dependencies"')) findings.push(`path traversal on report file: ${trav.status()}`);
  const ver = await ctx.get(`${API}/verify/${encodeURIComponent("' OR 1=1 --")}`);
  if (ver.status() >= 500) findings.push(`verify injection: ${ver.status()}`);
  const huge = await ctx.post(`${API}/auth/login`, { data: { email: 'a'.repeat(100000) + '@x.com', password: 'x' } });
  if (huge.status() >= 500) findings.push(`oversized login: ${huge.status()}`);
  const proto = await ctx.put(`${API}/auth/me`, { headers: a, data: JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"isAdmin":true}}}') });
  if (proto.status() >= 500) findings.push(`prototype keys: ${proto.status()}`);

  try { await removeUnpaid(bAppt.id); } catch { /* */ }
  console.log(`\nSECURITY FINDINGS (${findings.length}):\n${findings.join('\n') || 'none'}\n`);
  expect(findings).toEqual([]);
});
