const express = require('express');
const paymentMethodController = require('../controllers/paymentMethodController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');
const { uploadPaymentQrMiddleware } = require('../config/upload');

const router = express.Router();

// Public: a patient deciding whether to book needs to know they can pay by GCash first.
router.get('/', paymentMethodController.getAll);

// Before any '/:id' route, so 'manage' is never read as an id.
router.get('/manage', verifyToken, authorizeRoles('SuperAdmin'), paymentMethodController.getAllForManagement);

// The QR image. Signed-in only — the directory behind it also holds patients' payment
// screenshots, so nothing in it is served statically.
router.get('/:id/qr', verifyToken, paymentMethodController.getQr);

// SuperAdmin alone, matching superAdminRoutes.js. This is the account number a patient's money is
// about to be sent to: changing it silently redirects every subsequent payment, and the clinic
// finds out when the money does not arrive. Deliberately NOT delegable by permission — there is no
// version of this the front desk should be able to do.
router.post('/', verifyToken, authorizeRoles('SuperAdmin'), paymentMethodController.create);
router.put('/:id', verifyToken, authorizeRoles('SuperAdmin'), paymentMethodController.update);
router.patch('/:id', verifyToken, authorizeRoles('SuperAdmin'), paymentMethodController.update);
router.post('/:id/qr', verifyToken, authorizeRoles('SuperAdmin'), uploadPaymentQrMiddleware, paymentMethodController.uploadQr);

module.exports = router;
