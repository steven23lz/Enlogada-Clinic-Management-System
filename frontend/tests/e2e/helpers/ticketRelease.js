// Shared fixture helper for the ticket-release gating rule.
//
// Before gating, attaching a test to a visit was enough to make it appear on a modality
// worklist, so every diagnostic spec's fixture stopped at "create visit + attach tests".
// That is no longer a releasable state: a ticket reaches Ultrasound/X-Ray/Laboratory only once
// the visit is 'Processing', which requires a confirmed payment plus staff confirmation.
//
// These helpers perform the real release the same way the app does — through the public API,
// with no direct database writes — so the fixtures continue to model the actual clinic flow
// rather than a shortcut around the rule under test.

const CASHIER = { email: 'cashier@enlogada.com', password: 'Password123!' };

export async function loginAs(apiContext, API, creds) {
  const res = await apiContext.post(`${API}/auth/login`, { data: creds });
  return (await res.json()).data.token;
}

/**
 * Pays a walk-in visit at the counter, which is the whole release condition for a walk-in
 * (front-desk registration is its staff confirmation). Returns the payment response body.
 */
export async function payAndReleaseWalkIn(apiContext, API, visitId, cashierToken) {
  const token = cashierToken || (await loginAs(apiContext, API, CASHIER));
  const headers = { Authorization: `Bearer ${token}` };

  const billRes = await apiContext.get(`${API}/payments/bill/${visitId}`, { headers });
  const bill = (await billRes.json()).data.bill;

  const payRes = await apiContext.post(`${API}/payments`, {
    headers,
    data: {
      patientVisitId: visitId,
      paymentMethod: 'Cash',
      amount: parseFloat(bill.totalAmount)
    }
  });

  return { status: payRes.status(), body: await payRes.json(), bill };
}

/**
 * An appointment needs BOTH halves: a confirmed payment and a front-desk check-in. Confirming
 * the appointment is what the receptionist's QR scan does.
 */
export async function confirmAppointmentCheckIn(apiContext, API, appointmentId, receptionistToken) {
  return await apiContext.patch(`${API}/appointments/${appointmentId}/status`, {
    headers: { Authorization: `Bearer ${receptionistToken}` },
    data: { status: 'Confirmed' }
  });
}
