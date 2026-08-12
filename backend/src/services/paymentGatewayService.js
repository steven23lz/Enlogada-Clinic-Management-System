const crypto = require('crypto');
const env = require('../config/environment');
const logger = require('../config/logger');
const paymentRepository = require('../repositories/paymentRepository');
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

// clinic-facing payments.payment_method value -> PayMongo payment_method_types value.
// Restricted to the two e-wallets the clinic accepts online. 'card', 'grab_pay', 'qrph' etc.
// are valid PayMongo values but are deliberately NOT offered here.
const GATEWAY_METHODS = {
  GCash: 'gcash',
  PayMaya: 'paymaya'
};

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
  isConfigured() {
    return Boolean(env.PAYMONGO_SECRET_KEY);
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

    // Supersede any in-flight session rather than stacking up abandoned ones.
    await paymentRepository.cancelPendingGatewayPayments(patientVisitId);

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

    await paymentRepository.createPendingGatewayPayment({
      patientVisitId,
      processedBy: requestingUser.userId,
      paymentMethod,
      amount: totalAmount,
      gatewayProvider: PROVIDER,
      gatewaySessionId: sessionId
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

    const receiptNumber = await paymentRepository.getNextReceiptNumber();
    const settled = await paymentRepository.markGatewayPaymentPaid(sessionId, {
      gatewayPaymentId,
      receiptNumber
    });

    // Already settled by an earlier delivery of the same event — PayMongo retries deliveries.
    // Not an error, and must not double-release or double-notify.
    if (!settled) {
      return { handled: true, alreadySettled: true };
    }

    await notificationService.notifyRoles(['Cashier', 'Admin', 'SuperAdmin'], {
      title: 'Online Payment Received',
      message: `Receipt #${receiptNumber} — ${pending.first_name} ${pending.last_name}, PHP ${parseFloat(settled.amount).toFixed(2)} via ${settled.payment_method}`,
      type: 'success'
    });

    // Payment satisfied. For an appointment already checked in at the front desk this releases
    // the ticket now; otherwise it stays pending until the receptionist scans the QR.
    const release = await visitService.releaseVisitIfReady(settled.patient_visit_id);

    return { handled: true, released: release.released, receiptNumber };
  }
}

module.exports = new PaymentGatewayService();
