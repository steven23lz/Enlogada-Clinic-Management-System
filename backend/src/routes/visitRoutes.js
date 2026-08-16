const express = require('express');
const visitController = require('../controllers/visitController');
const { verifyToken, authorizeStaff, authorizeRoles, authorizePermissions } = require('../middlewares/auth');

const router = express.Router();

// Receptionist/Admin registers walk-in or appointment-based visits
router.post('/', verifyToken, authorizeStaff, authorizePermissions('visits:create'), visitController.registerVisit);

// Active visits for front desk / cashier dashboard
router.get('/active', verifyToken, authorizeStaff, authorizePermissions('visits:read'), visitController.getActiveVisits);

// UI/UX Phase 2: any-status, date-ranged visit history for Reception's Visit History view.
// Must be registered before '/:id' so 'history' isn't swallowed as an :id param.
router.get('/history', verifyToken, authorizeStaff, authorizePermissions('visits:read'), visitController.getVisitsByDateRange);

// Get specific visit details
router.get('/:id', verifyToken, authorizeStaff, authorizePermissions('visits:read'), visitController.getVisitById);

// Update visit status (Receptionist, Admin, Cashier)
router.put('/:id/status', verifyToken, authorizeStaff, authorizePermissions('visits:update'), visitController.updateStatus);
router.patch('/:id/status', verifyToken, authorizeStaff, authorizePermissions('visits:update'), visitController.updateStatus);

// Visit history per patient (staff or client viewing own patient)
router.get('/patient/:patientId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Cashier', 'Client'), authorizePermissions('visits:read'), visitController.getVisitHistory);

module.exports = router;
