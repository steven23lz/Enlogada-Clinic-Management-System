const express = require('express');
const appointmentController = require('../controllers/appointmentController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');
const { uploadHmoCardMiddleware } = require('../config/upload');

const router = express.Router();

// Client or Receptionist creates an appointment.
//
// uploadHmoCardMiddleware sits after verifyToken so an unauthenticated or deactivated caller can
// never cause a disk write, and so the filename can be seeded on the uploading user. It engages
// only for multipart bodies -- multer returns next() immediately for anything else -- so every
// existing JSON caller reaches the controller with a plain req.body exactly as before.
router.post('/', verifyToken, uploadHmoCardMiddleware, appointmentController.create);

// Client views their own bookings
router.get('/my-bookings', verifyToken, appointmentController.getMyBookings);

// Admin/SuperAdmin oversight — list all appointments, optionally filtered
router.get('/', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), appointmentController.getAll);

// Client or Receptionist retrieves bookable time slots for a given date
router.get('/availability', verifyToken, appointmentController.getAvailability);

// Receptionist verifies appointment by reference (QR scan or manual entry)
router.get('/verify/:reference', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist'), appointmentController.verifyReference);

// Client cancels their appointment
router.put('/:id/cancel', verifyToken, appointmentController.cancel);

// Staff updates appointment status (Confirmed, Completed, No Show)
router.put('/:id/status', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist'), appointmentController.updateStatus);
router.patch('/:id/status', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist'), appointmentController.updateStatus);

module.exports = router;
