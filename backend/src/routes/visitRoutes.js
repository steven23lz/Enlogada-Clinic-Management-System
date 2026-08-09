const express = require('express');
const visitController = require('../controllers/visitController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');

const router = express.Router();

// Receptionist/Admin registers walk-in or appointment-based visits
router.post('/', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist'), visitController.registerVisit);

// Active visits for front desk / cashier dashboard
router.get('/active', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Cashier'), visitController.getActiveVisits);

// Get specific visit details
router.get('/:id', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Cashier'), visitController.getVisitById);

// Update visit status (Receptionist, Admin, Cashier)
router.put('/:id/status', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Cashier'), visitController.updateStatus);
router.patch('/:id/status', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Cashier'), visitController.updateStatus);

// Visit history per patient (staff or client viewing own patient)
router.get('/patient/:patientId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Cashier', 'Client'), visitController.getVisitHistory);

module.exports = router;
