const express = require('express');
const reportController = require('../controllers/reportController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');

const router = express.Router();

// Module 17 (Reporting): clinic-wide metrics for a given date range. Admin/SuperAdmin only,
// matching the convention already established for /rbac/matrix and /admin/*.
router.get('/summary', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), reportController.getSummary);

module.exports = router;
