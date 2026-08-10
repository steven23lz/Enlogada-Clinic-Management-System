const express = require('express');
const router = express.Router();
const rbacController = require('../controllers/rbacController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');

// Viewing the matrix stays available to both — Module 12's dashboard already reads this for a
// stat card. Editing it is Module 13's "RBAC administration," explicitly elevated beyond Admin.
router.get('/matrix', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), rbacController.getRolesAndPermissions);
router.put('/roles/:roleId/permissions', verifyToken, authorizeRoles('SuperAdmin'), rbacController.updateRolePermissions);

module.exports = router;
