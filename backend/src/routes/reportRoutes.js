const express = require('express');
const reportController = require('../controllers/reportController');
const { verifyToken, authorizeStaff, authorizePermissions } = require('../middlewares/auth');

const router = express.Router();

// Module 17 (Reporting): clinic-wide metrics for a given date range. Admin/SuperAdmin only,
// matching the convention already established for /rbac/matrix and /admin/*.
router.get('/summary', verifyToken, authorizeStaff, authorizePermissions('reports:view'), reportController.getSummary);

// Feature Gap Plan Phase D: per-staff workload for Reception (check-ins) and Diagnostic
// (results released) — previously only Cashier had this kind of throughput visibility.
router.get('/staff-workload', verifyToken, authorizeStaff, authorizePermissions('reports:view'), reportController.getStaffWorkload);

module.exports = router;
