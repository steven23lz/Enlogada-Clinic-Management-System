const express = require('express');
const superAdminController = require('../controllers/superAdminController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');

const router = express.Router();

// Module 13 (Super Admin Management): elevated account management. SuperAdmin-only — Admin
// must not be able to create or manage Admin/SuperAdmin accounts, including its own.
router.get('/accounts', verifyToken, authorizeRoles('SuperAdmin'), superAdminController.getElevatedAccounts);
router.post('/accounts', verifyToken, authorizeRoles('SuperAdmin'), superAdminController.createElevatedAccount);
router.patch('/accounts/:id/status', verifyToken, authorizeRoles('SuperAdmin'), superAdminController.updateElevatedAccountStatus);

module.exports = router;
