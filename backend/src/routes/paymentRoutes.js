const express = require('express');
const paymentController = require('../controllers/paymentController');
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

// Refund or void a paid payment (Feature Gap Plan Phase A) — Cashier scope matches processPayment
router.patch('/:id/status', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Cashier'), paymentController.updateStatus);

// View payments for a specific visit
router.get('/visit/:visitId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Cashier'), paymentController.getVisitPayments);

module.exports = router;
