const crypto = require('crypto');
const appointmentRepository = require('../repositories/appointmentRepository');
const scheduleRepository = require('../repositories/scheduleRepository');
const env = require('../config/environment');
const logger = require('../config/logger');
const paymentRepository = require('../repositories/paymentRepository');
const db = require('../config/database');
const paymentService = require('./paymentService');
const patientService = require('./patientService');
const visitRepository = require('../repositories/visitRepository');
const visitService = require('./visitService');
const notificationService = require('./notificationService');

/**
 * Online payment for online-booked appointments, via PayMongo's hosted Checkout Session.
 *
 * Why an aggregator and not GCash/Maya directly: neither provider issues merchant API
 * credentials to an arbitrary application — in the Philippines you onboard through a
 * BSP-regulated payment processor, which then exposes them as payment methods. PayMongo
 * redirects the payer to GCash's and Maya's own real hosted payment pages; this is a genuine
 * provider redirect, not a simulation. The clinic must supply its own PAYMONGO_SECRET_KEY from
 * its own merchant account.
 *
 * Deliberately fails soft: with no key configured, isConfigured() is false, the client UI never
 * offers online payment, and the clinic operates exactly as it did before — cashier-recorded
 * payments only.
 */

// clinic-facing payments.payment_method value -> PayMongo payment_method_types value. Now defined
// in constants/paymentMethods.js, where the counter vocabulary lives too — a gateway key is
// written straight into payments.payment_method, so a key that is not a valid method would pass
// checkout and then violate chk_payment_method at settlement, after the patient had been charged.
// That module asserts the two agree at load. [1.33.0]
const { GATEWAY_METHODS } = require('../constants/paymentMethods');

const PROVIDER = 'paymongo';
const PAID_EVENT_TYPES = ['checkout_session.payment.paid', 'payment.paid'];

function assertConfigured() {
  if (!env.PAYMONGO_SECRET_KEY) {
    const error = new Error(
      'Online payment is not available. Please pay at the clinic counter, or contact the clinic.'
    );
    error.statusCode = 503;
    throw error;
  }
}

// PayMongo authenticates with HTTP Basic, secret key as the username and an empty password.
function authHeader() {
  return `Basic ${Buffer.from(`${env.PAYMONGO_SECRET_KEY}:`).toString('base64')}`;
}

// PayMongo works in centavos. Peso amounts here are NUMERIC(10,2), so round rather than
// truncate — parseFloat('1234.56') * 100 is 123455.99999999999 in binary floating point, and a
// truncating conversion would silently undercharge by one centavo.
function toCentavos(pesoAmount) {
  return Math.round(parseFloat(pesoAmount) * 100);
}

class PaymentGatewayService {
  /**
   * Online payment needs BOTH secrets, not one. [1.37.0]
   *
   * This used to test the API key alone, and the gap between the two was the most expensive
   * misconfiguration the system could hold. PayMongo issues the webhook signing secret separately
   * — a different value, from a different screen, shown once when a human creates the webhook —
   * and `verifyWebhookSignature` refuses everything without it.
   *
   * So with the key set and the webhook secret blank: the UI offered GCash, the patient really
   * was charged, every delivery was rejected 401 through PayMongo's entire retry schedule, the
   * payment stayed 'Pending', the visit was never released, and nobody was notified. Money taken,
   * nothing recorded, no error anywhere.
   *
   * Requiring both makes that state fail the safe way instead: online payment simply stays off,
   * the client is told to pay at the counter exactly as it is told today, and the backend says on
   * startup which half is missing. A clinic that has done half the setup now gets no online
   * payment rather than unrecorded payments.
   */
  isConfigured() {
    return Boolean(env.PAYMONGO_SECRET_KEY) && Boolean(env.PAYMONGO_WEBHOOK_SECRET);
  }

  /** Which half of the pair is missing, for the startup advisory. Null when nothing is set at
   *  all — that is a clinic running on counter payments, not a misconfiguration. */
  missingGatewaySecret() {
    const key = Boolean(env.PAYMONGO_SECRET_KEY);
    const hook = Boolean(env.PAYMONGO_WEBHOOK_SECRET);
    if (key === hook) return null;
    return key ? 'PAYMONGO_WEBHOOK_SECRET' : 'PAYMONGO_SECRET_KEY';
  }

  /** What the client UI needs in order to decide whether/how to offer online payment. */
  getGatewayStatus() {
    return {
      available: this.isConfigured(),
      provider: this.isConfigured() ? PROVIDER : null,
      methods: this.isConfigured() ? Object.keys(GATEWAY_METHODS) : []
    };
  }

  /**
   * Starts an online payment and returns the provider's hosted checkout URL for the browser to
   * redirect to. Creates a 'Pending' payments row keyed to the checkout session — never 'Paid'.
   */
  async createCheckoutSession({ patientVisitId, paymentMethod, requestingUser }) {
    assertConfigured();

    const gatewayMethod = GATEWAY_METHODS[paymentMethod];
    if (!gatewayMethod) {
      const error = new Error(
        `Unsupported online payment method. Available: ${Object.keys(GATEWAY_METHODS).join(', ')}.`
      );
      error.statusCode = 400;
      throw error;
    }

    const visit = await visitRepository.findVisitById(patientVisitId);
    if (!visit) {
      const error = new Error('Visit not found');
      error.statusCode = 404;
      throw error;
    }

    // A client may only pay for their own patients' visits. The same ownership rule is already
    // enforced in appointmentService and visitController — re-asserted here because this
    // endpoint is reachable by any logged-in Client and moves real money.
    if (requestingUser?.roles?.includes('Client')) {
      const patient = await patientService.getPatientById(visit.patient_id);
      if (patient.user_id !== requestingUser.userId) {
        const error = new Error('Access forbidden. This visit does not belong to your account.');
        error.statusCode = 403;
        throw error;
      }
    }

    // Authoritative, server-computed total — the amount is never taken from the client.
    const bill = await paymentService.getBillingSummary(patientVisitId);
    const totalAmount = parseFloat(bill.totalAmount);

    if (await paymentRepository.hasPaidPayment(patientVisitId)) {
      const error = new Error('This visit has already been paid.');
      error.statusCode = 409;
      throw error;
    }
    if (totalAmount <= 0) {
      const error = new Error('This visit has no outstanding balance to pay online.');
      error.statusCode = 400;
      throw error;
    }

    const lineItems = bill.items.map((item) => ({
      name: item.name,
      amount: toCentavos(item.price),
      currency: 'PHP',
      quantity: 1
    }));

    // HMO-covered tests still appear as line items but do not add to the payable total. Where
    // the two disagree the authoritative bill wins — charging the sum of line items would
    // overcharge a partially-covered patient.
    const lineItemTotal = lineItems.reduce((sum, li) => sum + li.amount, 0);
    const payableLineItems =
      lineItemTotal === toCentavos(totalAmount)
        ? lineItems
        : [{
            name: `Diagnostic services — Queue #${visit.queue_number}`,
            amount: toCentavos(totalAmount),
            currency: 'PHP',
            quantity: 1
          }];

    const payload = {
      data: {
        attributes: {
          line_items: payableLineItems,
          payment_method_types: [gatewayMethod],
          description: `Enlogada Clinic — Queue #${visit.queue_number}`,
          reference_number: `VISIT-${patientVisitId}`,
          success_url: `${env.FRONTEND_URL}/?payment=success&visit=${patientVisitId}`,
          cancel_url: `${env.FRONTEND_URL}/?payment=cancelled&visit=${patientVisitId}`,
          send_email_receipt: true,
          show_line_items: true
        }
      }
    };

    let response;
    let body;
    try {
      response = await fetch(`${env.PAYMONGO_API_BASE}/checkout_sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      body = await response.json();
    } catch (err) {
      logger.error('PayMongo checkout session request failed:', err);
      const error = new Error('Could not reach the payment provider. Please try again.');
      error.statusCode = 502;
      throw error;
    }

    if (!response.ok) {
      logger.error(`PayMongo rejected the checkout session: ${JSON.stringify(body)}`);
      const providerMessage = body && body.errors && body.errors[0] && body.errors[0].detail;
      const error = new Error(
        providerMessage
          ? `Payment provider error: ${providerMessage}`
          : 'The payment provider rejected this transaction.'
      );
      error.statusCode = 502;
      throw error;
    }

    const sessionId = body && body.data && body.data.id;
    const checkoutUrl =
      body && body.data && body.data.attributes && body.data.attributes.checkout_url;
    if (!sessionId || !checkoutUrl) {
      logger.error(`PayMongo returned an unexpected payload shape: ${JSON.stringify(body)}`);
      const error = new Error('The payment provider returned an unexpected response.');
      error.statusCode = 502;
      throw error;
    }

    // Supersede the previous session and record the new one together, and only now that PayMongo
    // has actually returned one.
    //
    // This used to cancel the in-flight session *before* the provider call, which lost money two
    // ways. If the PayMongo request then failed, the patient was left holding a checkout tab
    // whose row we had already marked Cancelled. And on the ordinary double-click path — patient
    // opens checkout, goes back, clicks Pay again — the first tab stayed open and payable: if
    // they completed *that* one, the webhook arrived for a session our own records called
    // Cancelled, markGatewayPaymentPaid matched zero rows, and the handler reported success. The
    // patient was charged, no Paid row existed, the visit was never released, and nobody was
    // told. handlePaidWebhook now also refuses to treat that case as a duplicate delivery.
    //
    // Ordering it this way narrows the window to the moments between PayMongo minting a session
    // and this commit, during which the worst case is a second live session rather than a live
    // session with no row behind it.
    await db.withTransaction(async () => {
      await paymentRepository.cancelPendingGatewayPayments(patientVisitId);
      await paymentRepository.createPendingGatewayPayment({
        patientVisitId,
        processedBy: requestingUser.userId,
        paymentMethod,
        amount: totalAmount,
        gatewayProvider: PROVIDER,
        gatewaySessionId: sessionId
      });
      // The patient is actively paying, so push their hold out by another window. [1.35.0]
      // A no-op on a permanent booking — extendHold requires held_until to already be set, so
      // opening checkout on an HMO or staff-created appointment cannot turn it provisional.
      await appointmentRepository.extendHold(patientVisitId);
    });

    return { checkoutUrl, sessionId, amount: totalAmount, paymentMethod };
  }

  /**
   * Verifies a PayMongo webhook signature.
   *
   * Header shape: `t=<timestamp>,te=<test signature>,li=<live signature>`. The signed string is
   * `<timestamp>.<raw request body>`, HMAC-SHA256 with the webhook secret. The RAW bytes matter
   * — re-serialising the parsed JSON changes them and every legitimate request would fail.
   */
  verifyWebhookSignature(rawBody, signatureHeader) {
    if (!env.PAYMONGO_WEBHOOK_SECRET || !signatureHeader || !rawBody) return false;

    const parts = {};
    for (const segment of String(signatureHeader).split(',')) {
      const [key, value] = segment.split('=');
      if (key && value) parts[key.trim()] = value.trim();
    }
    if (!parts.t) return false;

    const expected = crypto
      .createHmac('sha256', env.PAYMONGO_WEBHOOK_SECRET)
      .update(`${parts.t}.${rawBody.toString('utf8')}`)
      .digest('hex');

    // te carries test-mode events, li live-mode. Whichever is present for this event must
    // match; comparison is timing-safe.
    return [parts.te, parts.li].some((candidate) => {
      if (!candidate) return false;
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(candidate, 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
  }

  /**
   * Settles a verified webhook. This — not the browser's return to success_url — is the only
   * thing in the system that may mark an online payment 'Paid', and therefore the only thing
   * that can satisfy the payment half of the ticket release rule. success_url is a plain URL
   * the patient can navigate to directly and proves nothing.
   */
  async handlePaidWebhook(event) {
    const eventType = event && event.data && event.data.attributes && event.data.attributes.type;
    if (!PAID_EVENT_TYPES.includes(eventType)) {
      return { handled: false, reason: `Ignored event type: ${eventType}` };
    }

    const resource = event.data.attributes.data;
    const sessionId = resource && resource.id;
    const resourceAttrs = (resource && resource.attributes) || {};
    const gatewayPaymentId =
      (resourceAttrs.payments && resourceAttrs.payments[0] && resourceAttrs.payments[0].id) ||
      (resourceAttrs.payment_intent && resourceAttrs.payment_intent.id) ||
      null;

    if (!sessionId) {
      return { handled: false, reason: 'Event carried no checkout session id' };
    }

    const pending = await paymentRepository.findByGatewaySessionId(sessionId);
    if (!pending) {
      logger.warn(`PayMongo webhook for unknown checkout session ${sessionId} — ignored.`);
      return { handled: false, reason: 'Unknown checkout session' };
    }

    // Cheap check before minting anything. PayMongo retries deliveries, and receipt numbers now
    // come from a per-day counter that never rewinds, so calling getNextReceiptNumber on every
    // redelivery would burn a number each time and punch gaps in the official receipt sequence.
    if (pending.payment_status === 'Paid') {
      return { handled: true, alreadySettled: true };
    }

    const receiptNumber = await paymentRepository.getNextReceiptNumber();
    let settled = await paymentRepository.markGatewayPaymentPaid(sessionId, {
      gatewayPaymentId,
      receiptNumber
    });

    // Zero rows updated means the row was not 'Pending'. That used to be reported as
    // `alreadySettled` and a 200, which conflated two very different situations — and one of them
    // was the clinic keeping money it had not recorded.
    if (!settled) {
      const current = await paymentRepository.findByGatewaySessionId(sessionId);

      // (a) A concurrent delivery settled it between our check and our update. Genuinely
      //     idempotent; nothing more to do.
      if (current && current.payment_status === 'Paid') {
        return { handled: true, alreadySettled: true };
      }

      // (b) The row is Cancelled or Failed, but PayMongo says this session was paid. This is the
      //     patient who opened a second checkout and then went back and completed the first tab.
      //     The money has moved. Refusing to record it does not give it back — it just means the
      //     clinic holds an unrecorded payment and the patient waits for an exam nobody can see.
      logger.error(
        `PayMongo reports session ${sessionId} PAID while our record says ` +
          `${current ? current.payment_status : 'missing'} — settling anyway and alerting staff.`
      );
      try {
        settled = await paymentRepository.forceSettleGatewayPayment(sessionId, {
          gatewayPaymentId,
          receiptNumber
        });
      } catch (err) {
        // uq_payments_one_paid_per_visit: this visit already has a settled payment, so the
        // patient has been charged twice — once online and once at the counter. Recording a
        // second Paid row would hide that; it needs a refund and a human. Fails loudly instead.
        if (err.code === '23505') {
          logger.error(
            `DOUBLE PAYMENT: visit for session ${sessionId} is already paid by another method. ` +
              'The online payment must be refunded — this was NOT recorded as a second payment.'
          );
          await notificationService.notifyRoles(['Cashier', 'Admin', 'SuperAdmin'], {
            title: 'Double payment — refund required',
            message: `An online payment settled for a visit already paid at the counter (session ${sessionId}). Refund the online payment.`,
            type: 'critical'
          });
          return { handled: true, doublePayment: true, requiresRefund: true };
        }
        throw err;
      }

      if (settled) {
        await notificationService.notifyRoles(['Cashier', 'Admin', 'SuperAdmin'], {
          title: 'Online payment recovered',
          message: `A superseded checkout session was completed and has been recorded (receipt #${receiptNumber}). Verify against the provider dashboard.`,
          type: 'warning'
        });
      }
    }

    if (!settled) {
      return { handled: true, alreadySettled: true };
    }

    await notificationService.notifyRoles(['Cashier', 'Admin', 'SuperAdmin'], {
      title: 'Online Payment Received',
      message: `Receipt #${receiptNumber} — ${pending.first_name} ${pending.last_name}, PHP ${parseFloat(settled.amount).toFixed(2)} via ${settled.payment_method}`,
      type: 'success'
    });

    // The slot is paid for, so the hold becomes a claim. [1.35.0]
    //
    // Unconditional on the hold still being alive. If the patient took longer than the window and
    // the slot was resold in the meantime, the money has still moved — refusing to honour the
    // booking does not give it back, which is the same reasoning forceSettleGatewayPayment is
    // built on. So the appointment stands and staff are told it overbooked, rather than a paid
    // patient being quietly left without a slot.
    const confirmed = await appointmentRepository.confirmHold(settled.patient_visit_id);
    if (confirmed) {
      const contended = await appointmentRepository.countActiveInSlot({
        scheduledDate: confirmed.scheduled_date,
        scheduledTime: confirmed.scheduled_time,
        excludeId: confirmed.id
      });
      // node-pg parses DATE at LOCAL midnight, so getDay() on it is the local weekday — the same
      // basis clinic_operating_hours is keyed on. getUTCDay() would be a day out in Manila.
      const hours = await scheduleRepository.findOperatingHoursForDay(
        new Date(confirmed.scheduled_date).getDay()
      );
      if (hours && contended >= hours.max_concurrent_bookings) {
        await notificationService.notifyRoles(['Admin', 'SuperAdmin', 'Receptionist'], {
          title: 'Slot overbooked by a late payment',
          message:
            `${confirmed.appointment_reference} paid after its hold lapsed and the slot had been ` +
            'taken. The booking stands — the money was received. Two patients now hold this time.',
          type: 'warning'
        });
      }
    }

    // Payment satisfied. For an appointment already checked in at the front desk this releases
    // the ticket now; otherwise it stays pending until the receptionist scans the QR.
    const release = await visitService.releaseVisitIfReady(settled.patient_visit_id);

    return { handled: true, released: release.released, receiptNumber };
  }
}

module.exports = new PaymentGatewayService();
