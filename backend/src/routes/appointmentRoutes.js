const express = require('express');
const appointmentController = require('../controllers/appointmentController');
const { verifyToken, authorizeStaff, authorizeRoles, authorizePermissions } = require("../middlewares/auth");

const router = express.Router();

// Client or Receptionist creates an appointment
router.post('/', verifyToken, appointmentController.create);

// Client views their own bookings
router.get('/my-bookings', verifyToken, appointmentController.getMyBookings);

// Admin/SuperAdmin oversight — list all appointments, optionally filtered
router.get('/', verifyToken, authorizeStaff, authorizePermissions('appointments:read'), appointmentController.getAll);

// Client or Receptionist retrieves bookable time slots for a given date
router.get('/availability', verifyToken, appointmentController.getAvailability);

// Receptionist verifies appointment by reference (QR scan or manual entry)
router.get('/verify/:reference', verifyToken, authorizeStaff, authorizePermissions('appointments:read'), appointmentController.verifyReference);

// Client cancels their own appointment; front office cancels on a patient's behalf.
//
// This carried verifyToken alone while its sibling /:id/status — a less destructive operation on
// the same resource — was role-gated. The service's assertClientOwnsPatient returns immediately
// for any non-Client role, so that asymmetry meant a Laboratory, Xray, Ultrasound or Cashier
// token could walk PUT /api/appointments/1/cancel … /N/cancel and empty the appointment book,
// cascading each cancellation to the linked visit.
router.put('/:id/cancel', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Client'), appointmentController.cancel);

// Staff updates appointment status (Confirmed, Completed, No Show)
router.put('/:id/status', verifyToken, authorizeStaff, authorizePermissions('appointments:update'), appointmentController.updateStatus);
router.patch('/:id/status', verifyToken, authorizeStaff, authorizePermissions('appointments:update'), appointmentController.updateStatus);

module.exports = router;
