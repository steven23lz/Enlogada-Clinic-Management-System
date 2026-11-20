// @ts-check
import { test, expect, request } from 'playwright/test';
import { signInTo } from './helpers/auth.js';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, fixtureEmail, FIXTURE_CONTACT } from './helpers/people.js';
import { registerClient } from './helpers/accounts.js';
import { appointmentForm } from './helpers/booking.js';
import { nthWorkingDay } from './helpers/dates.js';
import { ensureMethod } from './helpers/payments.js';
import { reportPart } from './helpers/reportFile.js';

/**
 * Hostile input: what someone types, or uploads, to make the system run their code. [1.172.0]
 *
 * Steven: "do everything", the second being a security pass. Free text a patient or the front desk
 * types (a feedback comment, an HMO refusal reason, a reschedule reason) is shown on staff screens
 * and in the Activity Log; each is given a script and an image that runs one, and every screen that
 * shows it must show it as text and run nothing. A file is judged by what it is, not by what its
 * name says. A name is a name, refused at the door (second-walk.spec.js).
 */

const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';
const API = `${BACKEND_URL}/api`;
const PASSWORD = 'Password123!';
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const PAYLOAD = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
const HTML_AS_PNG = Buffer.from('<html><body><script>alert(1)</script></body></html>');
const SVG_SCRIPT = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

test.describe('Hostile input [1.172.0]', () => {
  let ctx, desk, till, admin, superAdmin, lab, labTest, method;
  const login = async (e) => (await (await ctx.post(`${API}/auth/login`, { data: { email: e, password: PASSWORD } })).json()).data.token;

  test.beforeAll(async () => {
    ctx = await request.newContext();
    [desk, till, admin, superAdmin, lab] = await Promise.all(
      ['receptionist@enlogada.com', 'multirole@enlogada.com', 'clinicadmin@enlogada.com', 'admin@enlogada.com', 'lab@enlogada.com'].map(login)
    );
    labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests.find((t) => t.category_name === 'Laboratory' && t.is_active);
    method = await ensureMethod(ctx, superAdmin);
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  const walkIn = async () => {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: { patientTypeId: await patientTypeId(ctx, API, desk), ...person, birthdate: '1980-04-04', sex: 'Female', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const visit = (await (await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', testIds: [labTest.id] } })).json()).data.visit;
    return { person, patient, visit };
  };

  test('a script typed into a comment or a reason is shown as text on every staff screen, and runs nothing', async ({ page }) => {
    test.setTimeout(120000);
    // A finished visit, with a paper feedback form carrying the payload as its comment.
    const { person, visit } = await walkIn();
    const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth(till) })).json()).data.bill;
    expect((await ctx.post(`${API}/payments`, { headers: auth(till), data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: Number(bill.totalAmount) } })).status()).toBe(201);
    const [line] = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(desk) })).json()).data.visitTests;
    await ctx.post(`${API}/results/${line.id}`, { headers: auth(lab), multipart: { file: reportPart('lab') } });
    expect((await ctx.post(`${API}/results/${line.id}/release`, { headers: auth(lab) })).status()).toBe(200);
    const questions = (await (await ctx.get(`${API}/feedback/questions`, { headers: auth(admin) })).json()).data;
    const q = (questions.questions || questions)[0];
    const fb = await ctx.post(`${API}/feedback/visits/${visit.id}/paper`, { headers: auth(desk), data: { answers: { [q.id]: 1 }, comment: PAYLOAD } });
    expect(fb.status(), await fb.text()).toBe(201);

    // An HMO claim refused with the payload as its reason.
    const other = await walkIn();
    const [otherLine] = (await (await ctx.get(`${API}/tests/visit-tests/${other.visit.id}`, { headers: auth(desk) })).json()).data.visitTests;
    const provider = (await (await ctx.get(`${API}/hmo/providers`, { headers: auth(desk) })).json()).data.providers[0];
    const claim = await ctx.post(`${API}/hmo/request`, {
      headers: auth(desk), data: { hmoProviderId: provider.id, memberNumber: '1CH-0000999', visitTestIds: [otherLine.id], referringPhysician: 'Dr. Reyes' },
    });
    const claimBody = (await claim.json()).data;
    const claimId = (claimBody.request || claimBody.hmoRequest || claimBody).id;
    expect((await ctx.put(`${API}/hmo/request/${claimId}/reject`, { headers: auth(admin), data: { decisionReason: PAYLOAD } })).status()).toBe(200);

    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', async (d) => { errors.push(`a dialog opened: ${d.message()}`); await d.dismiss(); });

    await signInTo(page, 'clinicadmin@enlogada.com', 'Patient Feedback');
    await expect(page.getByText(PAYLOAD.slice(0, 20)).first(), 'the comment is shown as typed').toBeVisible({ timeout: 20000 });

    for (const screen of ['Service Requests', 'Activity Log']) {
      await page.getByRole('button', { name: screen, exact: true }).first().click();
      await page.waitForTimeout(1500);
    }
    await page.getByRole('button', { name: 'Service Requests', exact: true }).first().click();
    const row = page.getByRole('row', { name: new RegExp(other.person.lastName) }).first();
    if (await row.isVisible().catch(() => false)) {
      await row.getByRole('button', { name: 'Review' }).click();
      await expect(page.getByRole('dialog').getByText(PAYLOAD.slice(0, 20)).first(), 'the reason is shown as typed').toBeVisible({ timeout: 10000 });
      await page.keyboard.press('Escape');
    }

    expect(await page.evaluate(() => window.__pwned), 'nothing ran').toBeUndefined();
    expect(errors, errors.join(' | ')).toHaveLength(0);
    expect(person.fullName).toBeTruthy();
  });

  test('a web page or a scripted SVG renamed as a picture is refused wherever a file is taken', async () => {
    // A payment proof.
    const person = fixturePerson();
    const { token } = await registerClient(ctx, { ...person, email: fixtureEmail(person), password: PASSWORD });
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(token), data: { patientTypeId: await patientTypeId(ctx, API, token), ...person, birthdate: '1990-01-01', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const booked = await ctx.post(`${API}/appointments`, {
      headers: auth(token), multipart: appointmentForm({ patientId: patient.id, scheduledDate: nthWorkingDay(254), scheduledTime: '09:00', testIds: [labTest.id] }),
    });
    const appt = (await booked.json()).data.appointment;
    const proof = await ctx.post(`${API}/payment-submissions`, {
      headers: auth(token),
      multipart: { patientVisitId: String(appt.patient_visit_id), paymentMethodId: String(method.id), referenceNumber: `X${Date.now()}`, proof: { name: 'gcash.png', mimeType: 'image/png', buffer: HTML_AS_PNG } },
    });
    expect(proof.status(), 'a web page called gcash.png').toBe(400);

    // A doctor's request on a booking.
    const req = new FormData();
    req.append('patientId', String(patient.id));
    req.append('scheduledDate', nthWorkingDay(255));
    req.append('scheduledTime', '09:00');
    req.append('testIds[]', String(labTest.id));
    req.append('doctorRequest', new Blob([HTML_AS_PNG], { type: 'image/png' }), 'request.png');
    const withPage = await ctx.post(`${API}/appointments`, { headers: auth(token), multipart: req });
    expect(withPage.status(), "a web page as the doctor's request").toBe(400);

    // An avatar.
    const avatar = await ctx.post(`${API}/auth/me/avatar`, { headers: auth(token), multipart: { avatar: { name: 'me.svg', mimeType: 'image/svg+xml', buffer: SVG_SCRIPT } } });
    expect(avatar.status(), 'a scripted SVG as a photo').toBeGreaterThanOrEqual(400);
    const avatar2 = await ctx.post(`${API}/auth/me/avatar`, { headers: auth(token), multipart: { avatar: { name: 'me.png', mimeType: 'image/png', buffer: HTML_AS_PNG } } });
    expect(avatar2.status(), 'a web page called me.png').toBeGreaterThanOrEqual(400);

    // A report.
    const { visit } = await walkIn();
    const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth(till) })).json()).data.bill;
    await ctx.post(`${API}/payments`, { headers: auth(till), data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: Number(bill.totalAmount) } });
    const [line] = (await (await ctx.get(`${API}/tests/visit-tests/${visit.id}`, { headers: auth(desk) })).json()).data.visitTests;
    const report = await ctx.post(`${API}/results/${line.id}`, { headers: auth(lab), multipart: { file: { name: 'report.pdf', mimeType: 'application/pdf', buffer: HTML_AS_PNG } } });
    expect(report.status(), 'a web page called report.pdf').toBeGreaterThanOrEqual(400);
  });
});
