// @ts-check
import { test, expect, request } from 'playwright/test';
import { patientTypeId } from './helpers/patients.js';
import { fixturePerson, FIXTURE_CONTACT } from './helpers/people.js';
import { runScript } from './helpers/backendScript.js';
import { API, CREDS, loginAs } from './helpers/payments.js';

/**
 * A busy day: many patients past 60 minutes ring the bell once per department. [1.172.0]
 *
 * The overdue alert rang once PER PATIENT, for the department's staff, the Admin and the Super
 * Admin, so a hundred patients waiting meant a hundred notifications each and nothing else in the
 * bell could be found. Now one sweep finding several sends one notification for the department,
 * naming the first three; the red banner above every screen is unchanged.
 */

const auth = (t) => ({ Authorization: `Bearer ${t}` });

test('two patients going over together ring the department\'s bell once, naming both', async () => {
  const ctx = await request.newContext();
  const [desk, till, lab] = await Promise.all([
    loginAs(ctx, CREDS.receptionist), loginAs(ctx, { email: 'multirole@enlogada.com', password: 'Password123!' }),
    loginAs(ctx, { email: 'lab@enlogada.com', password: 'Password123!' }),
  ]);
  const labTest = (await (await ctx.get(`${API}/tests`)).json()).data.tests.find((t) => t.is_active && t.category_name === 'Laboratory' && Number(t.price) > 0);
  const sweep = () => Number(runScript('e2eOverdue.js', ['--sweep'], 'overdue sweep').trim().split('\n').pop());
  sweep();

  const people = [];
  for (let i = 0; i < 2; i += 1) {
    const person = fixturePerson();
    const patient = (await (await ctx.post(`${API}/patients`, {
      headers: auth(desk),
      data: { patientTypeId: await patientTypeId(ctx, API, desk, 'Self Pay'), ...person, birthdate: '1980-01-01', sex: 'Male', contactNumber: FIXTURE_CONTACT },
    })).json()).data.patient;
    const visit = (await (await ctx.post(`${API}/visits`, { headers: auth(desk), data: { patientId: patient.id, visitType: 'Walk in', testIds: [labTest.id] } })).json()).data.visit;
    const bill = (await (await ctx.get(`${API}/payments/bill/${visit.id}`, { headers: auth(till) })).json()).data.bill;
    expect((await ctx.post(`${API}/payments`, { headers: auth(till), data: { patientVisitId: visit.id, paymentMethod: 'Cash', amount: Number(bill.totalAmount) } })).status()).toBe(201);
    runScript('e2eOverdue.js', [`--visit=${visit.id}`, '--minutes=70'], 'move visit');
    people.push(person);
  }

  const bellBefore = (await (await ctx.get(`${API}/notifications`, { headers: auth(lab) })).json()).data;
  const countBefore = (bellBefore.notifications || bellBefore).length;
  expect(sweep(), 'both patients were told about').toBeGreaterThanOrEqual(2);
  const bellAfter = (await (await ctx.get(`${API}/notifications`, { headers: auth(lab) })).json()).data;
  const list = bellAfter.notifications || bellAfter;
  const grouped = list.find((n) => /No test result uploaded for \d+ patients in Laboratory/.test(n.title));
  expect(grouped, 'one notification for the department').toBeTruthy();
  expect(list.length - countBefore, 'one new notification, not one per patient').toBeLessThanOrEqual(1 + 2);
  for (const p of people) {
    const named = grouped.message.includes(`${p.firstName} ${p.lastName}`) || /and \d+ more/.test(grouped.message);
    expect(named, `${p.fullName} is named or counted`).toBe(true);
  }
  await ctx.dispose();
});
