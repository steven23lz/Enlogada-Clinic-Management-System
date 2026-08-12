const paymentGatewayService = require('../services/paymentGatewayService');
const logger = require('../config/logger');

class PaymentGatewayController {
  async getStatus(req, res, next) {
    try {
      return res.status(200).json({
        status: 'success',
        data: { gateway: paymentGatewayService.getGatewayStatus() }
      });
    } catch (err) {
      next(err);
    }
  }

  async createCheckout(req, res, next) {
    try {
      const { patientVisitId, paymentMethod } = req.body;

      if (!patientVisitId || !paymentMethod) {
        return res.status(400).json({
          status: 'error',
          message: 'Patient visit ID and payment method are required.'
        });
      }

      const session = await paymentGatewayService.createCheckoutSession({
        patientVisitId,
        paymentMethod,
        requestingUser: req.user
      });

      return res.status(201).json({
        status: 'success',
        message: `Redirecting to ${paymentMethod}.`,
        data: { checkout: session }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PayMongo webhook receiver. Unauthenticated by necessity — the caller is PayMongo, not a
   * logged-in user — so the signature IS the authentication. An unverified request is rejected
   * before its body is parsed or trusted in any way.
   */
  async handleWebhook(req, res) {
    // Captured by the express.json `verify` hook in app.js. Signature is computed over the raw
    // bytes; re-serialising req.body would change them and fail every legitimate delivery.
    const rawBody = req.rawBody;
    const signature = req.get('Paymongo-Signature');

    if (!paymentGatewayService.verifyWebhookSignature(rawBody, signature)) {
      logger.warn('Rejected a PayMongo webhook with a missing or invalid signature.');
      return res.status(401).json({ status: 'error', message: 'Invalid signature.' });
    }

    try {
      const outcome = await paymentGatewayService.handlePaidWebhook(req.body);
      // Always 200 on a verified event, even one we choose to ignore: a non-2xx makes PayMongo
      // retry indefinitely for an event that will never become relevant.
      return res.status(200).json({ status: 'success', data: outcome });
    } catch (err) {
      // A 500 here is correct — it asks PayMongo to redeliver, and settlement is idempotent.
      logger.error('Failed to process a verified PayMongo webhook:', err);
      return res.status(500).json({ status: 'error', message: 'Webhook processing failed.' });
    }
  }
}

module.exports = new PaymentGatewayController();
