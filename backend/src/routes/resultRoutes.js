const express = require('express');
const resultController = require('../controllers/resultController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');

const router = express.Router();

// Department staff views pending tests by category (Laboratory, Xray, Ultrasound)
router.get('/pending/:category', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.getPending);

// Department staff updates a visit_test status (Processing, Completed, etc.)
router.put('/test-status/:visitTestId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.updateTestStatus);
router.patch('/test-status/:visitTestId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.updateTestStatus);

// Department staff uploads findings for a visit_test
router.post('/:visitTestId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.uploadResult);

// Department staff releases result and triggers email notification
router.post('/:visitTestId/release', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.releaseResult);

// View patient result history (staff or client viewing own patient)
router.get('/history/:patientId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff', 'Client'), resultController.getPatientHistory);

module.exports = router;
