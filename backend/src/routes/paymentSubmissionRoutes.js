const express = require('express');
const paymentSubmissionController = require('../controllers/paymentSubmissionController');
const { verifyToken, authorizeStaff, authorizeRoles, authorizePermissions } = require('../middlewares/auth');
const { uploadPaymentProofMiddleware } = require('../config/upload');

const router = express.Router();

// A patient submits their own proof. Reception may do it on their behalf for someone who paid
// online and then rang the clinic, so the role list is the booking-side one — and it is paired
// with a permission, which verifyRbacWiring then insists every named role holds.
router.post(
  '/',
  verifyToken,
  authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Client'),
  authorizePermissions('billing:submit_proof'),
  uploadPaymentProofMiddleware,
  paymentSubmissionController.submit
);

// Before '/:id' so 'pending' is never read as an id.
router.get('/pending', verifyToken, authorizeStaff, authorizePermissions('billing:read'), paymentSubmissionController.getPending);

// A client reads their own; the service enforces ownership per patient profile.
router.get('/visit/:visitId', verifyToken, paymentSubmissionController.getForVisit);
router.get('/:id/proof', verifyToken, paymentSubmissionController.getProof);

// Deciding is taking money, so it is the same permission as taking a payment at the counter.
router.post('/:id/verify', verifyToken, authorizeStaff, authorizePermissions('billing:process'), paymentSubmissionController.verify);
router.post('/:id/reject', verifyToken, authorizeStaff, authorizePermissions('billing:process'), paymentSubmissionController.reject);

module.exports = router;
