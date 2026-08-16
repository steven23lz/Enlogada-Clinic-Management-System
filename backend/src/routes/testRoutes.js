const express = require('express');
const testController = require('../controllers/testController');
const { verifyToken, authorizeStaff, authorizeRoles, authorizePermissions } = require('../middlewares/auth');

const router = express.Router();

// Public test catalog (browsable by all website visitors and patients)
router.get('/', testController.getAll);
router.get('/categories', testController.getCategories);
router.get('/:id', testController.getById);

// SuperAdmin manages tests
router.post('/', verifyToken, authorizeStaff, authorizePermissions('tests:manage'), testController.create);
router.put('/:id', verifyToken, authorizeStaff, authorizePermissions('tests:manage'), testController.update);
router.patch('/:id', verifyToken, authorizeStaff, authorizePermissions('tests:manage'), testController.update);
router.patch('/:id/price', verifyToken, authorizeStaff, authorizePermissions('tests:manage'), testController.updatePrice);

// Receptionist/Admin assigns tests to a visit
router.post('/visit-tests', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Client'), authorizePermissions('tests:assign'), testController.addTestsToVisit);
router.get('/visit-tests/:visitId', verifyToken, authorizeStaff, authorizePermissions('tests:read_assigned'), testController.getVisitTests);

module.exports = router;
