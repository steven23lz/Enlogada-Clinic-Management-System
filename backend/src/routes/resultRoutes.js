const express = require('express');
const resultController = require('../controllers/resultController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');
const { uploadResultFileMiddleware } = require('../config/upload');

const router = express.Router();

// Role split on this router is deliberate and asymmetric: Admin READS everything here, but does
// not WRITE. A test_result records the clinician who authored and released it, so an Admin
// entering findings or releasing a result puts the clinic manager's name on a clinical record
// they did not produce — and that same role administers staff accounts and the audit log.
// SuperAdmin keeps the write routes as break-glass for an unstaffed department.
// The sidebar reflects the same boundary; see frontend/src/config/navigation.js.

// Department staff views pending tests by category (Laboratory, Xray, Ultrasound)
router.get('/pending/:category', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.getPending);

// UI/UX Phase 1: department staff review results they've already released, by category
router.get('/released/:category', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.getReleased);

// Department staff updates a visit_test status (Processing, Completed, etc.)
router.put('/test-status/:visitTestId', verifyToken, authorizeRoles('SuperAdmin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.updateTestStatus);
router.patch('/test-status/:visitTestId', verifyToken, authorizeRoles('SuperAdmin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.updateTestStatus);

// Department staff uploads findings for a visit_test — multipart/form-data with an optional
// 'file' field (Feature Gap Plan Phase B); findings/remarks still arrive as regular text fields.
router.post('/:visitTestId', verifyToken, authorizeRoles('SuperAdmin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), uploadResultFileMiddleware, resultController.uploadResult);

// Download the uploaded result file — authenticated, ownership-checked inside the service (staff
// department match or Client-owns-this-patient), never a public static path (PHI).
router.get('/:visitTestId/file', verifyToken, resultController.downloadResultFile);

// Department staff releases result and triggers email notification
router.post('/:visitTestId/release', verifyToken, authorizeRoles('SuperAdmin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.releaseResult);

// View patient result history (staff or client viewing own patient)
router.get('/history/:patientId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff', 'Client'), resultController.getPatientHistory);

// Fetch the recorded result for one visit_test, so staff can edit findings already saved
// against a 'Waiting for Release' ticket. Registered last: a bare '/:visitTestId' would
// otherwise shadow nothing here (every route above has two segments), but keeping catch-all
// shapes at the bottom is the convention this codebase already follows in visitRoutes.
router.get('/:visitTestId', verifyToken, authorizeRoles('SuperAdmin', 'Admin', 'Laboratory Staff', 'Xray Staff', 'Ultrasound Staff'), resultController.getResult);

module.exports = router;
