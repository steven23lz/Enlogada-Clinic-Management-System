const express = require('express');
const paymentController = require('../controllers/paymentController');
const paymentGatewayController = require('../controllers/paymentGatewayController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');

const router = express.Router();

// Get billing summary for a visit
router.get('/bill/:visitId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Cashier'), paymentController.getBill);

// Client-side payment visibility — self-scoped via req.user.userId, no role restriction beyond
// being logged in (matches /patients/my-profiles, /appointments/my-bookings).
router.get('/my-payments', verifyToken, paymentController.getMyPayments);

// Process a payment
router.post('/', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Cashier'), paymentController.processPayment);

// View transactions (with optional date range filters)
router.get('/transactions', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Cashier'), paymentController.getTransactions);

// View payments for a specific visit
router.get('/visit/:visitId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Cashier'), paymentController.getVisitPayments);

// --- Online payment gateway (GCash / Maya) ------------------------------------------------

// Is online payment configured on this deployment? Any logged-in user may ask; the client UI
// hides the online-payment option entirely when this reports unavailable.
router.get('/gateway/status', verifyToken, paymentGatewayController.getStatus);

// Start an online payment and get the provider's hosted checkout URL. Self-scoped: the service
// verifies the caller owns the visit's patient before creating anything — but that ownership
// check only applies to the 'Client' role, so the role restriction below is still required:
// without it, any other authenticated role (which the service does not ownership-check at all)
// could open a real PayMongo checkout session against an arbitrary visit.
router.post('/gateway/checkout', verifyToken, authorizeRoles('Client', 'SuperAdmin', 'Admin'), paymentGatewayController.createCheckout);

// Provider callback. NOT verifyToken-gated — the caller is PayMongo, not a user. The HMAC
// signature over the raw body is the authentication (see paymentGatewayService).
router.post('/gateway/webhook', paymentGatewayController.handleWebhook);

module.exports = router;
