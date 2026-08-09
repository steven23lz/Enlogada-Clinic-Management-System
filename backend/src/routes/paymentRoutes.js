const express = require('express');
const paymentController = require('../controllers/paymentController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');

const router = express.Router();

// Get billing summary for a visit
router.get('/bill/:visitId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Cashier'), paymentController.getBill);

// Process a payment
router.post('/', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Cashier'), paymentController.processPayment);

// View transactions (with optional date range filters)
router.get('/transactions', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Cashier'), paymentController.getTransactions);

// View payments for a specific visit
router.get('/visit/:visitId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Cashier'), paymentController.getVisitPayments);

module.exports = router;
