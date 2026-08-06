const express = require('express');
const testController = require('../controllers/testController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');

const router = express.Router();

// Public test catalog (browsable by all website visitors and patients)
router.get('/', testController.getAll);
router.get('/categories', testController.getCategories);
router.get('/:id', testController.getById);

// SuperAdmin manages tests
router.post('/', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), testController.create);
router.put('/:id', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), testController.update);
router.patch('/:id', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), testController.update);
router.patch('/:id/price', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), testController.updatePrice);

// Receptionist/Admin assigns tests to a visit
router.post('/visit-tests', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Receptionist', 'Client'), testController.addTestsToVisit);
router.get('/visit-tests/:visitId', verifyToken, testController.getVisitTests);

module.exports = router;
