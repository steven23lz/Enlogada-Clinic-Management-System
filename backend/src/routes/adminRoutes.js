const express = require('express');
const adminController = require('../controllers/adminController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');

const router = express.Router();

// Module 12 (Admin Dashboard): staff account management, scoped to the 5 operational roles
// only. Admin/SuperAdmin account management is Module 13's responsibility.
router.get('/staff', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), adminController.getStaff);
router.post('/staff', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), adminController.createStaff);
router.patch('/staff/:id/status', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), adminController.updateStaffStatus);

// Feature Gap Plan Phase A: Admin sets a temporary password for a locked-out staff member —
// previously the only recourse was deactivating and recreating the account.
router.patch('/staff/:id/password', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), adminController.resetStaffPassword);

module.exports = router;
