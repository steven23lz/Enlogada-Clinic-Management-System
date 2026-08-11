const express = require('express');
const resultController = require('../controllers/resultController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');
const { uploadResultFileMiddleware } = require('../config/upload');

const router = express.Router();

// Department staff views pending tests by category (Laboratory, Xray, Ultrasound)
router.get('/pending/:category', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.getPending);

// UI/UX Phase 1: department staff review results they've already released, by category
router.get('/released/:category', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.getReleased);

// Department staff updates a visit_test status (Processing, Completed, etc.)
router.put('/test-status/:visitTestId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.updateTestStatus);
router.patch('/test-status/:visitTestId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.updateTestStatus);

// Department staff uploads findings for a visit_test — multipart/form-data with an optional
// 'file' field (Feature Gap Plan Phase B); findings/remarks still arrive as regular text fields.
router.post('/:visitTestId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), uploadResultFileMiddleware, resultController.uploadResult);

// Download the uploaded result file — authenticated, ownership-checked inside the service (staff
// department match or Client-owns-this-patient), never a public static path (PHI).
router.get('/:visitTestId/file', verifyToken, resultController.downloadResultFile);

// Department staff releases result and triggers email notification
router.post('/:visitTestId/release', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.releaseResult);

// View patient result history (staff or client viewing own patient)
router.get('/history/:patientId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff', 'Client'), resultController.getPatientHistory);

module.exports = router;
