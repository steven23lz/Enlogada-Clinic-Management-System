const express = require('express');
const router = express.Router();
const rbacController = require('../controllers/rbacController');
const { verifyToken, authorizeRoles, authorizePermissions } = require('../middlewares/auth');

// Viewing the matrix stays available to both — Module 12's dashboard already reads this for a
// stat card. Editing it is Module 13's "RBAC administration," explicitly elevated beyond Admin.
router.get('/matrix', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), rbacController.getRolesAndPermissions);
router.put('/roles/:roleId/permissions', verifyToken, authorizeRoles('SuperAdmin'), rbacController.updateRolePermissions);

// Per-account exceptions and department assignment. [1.20.0]
//
// Same gate as editing a role, and for the same reason: this decides who may do what. It is if
// anything the sharper of the two — a role edit is visible in the matrix everyone reads, while an
// exception applies to one person and is easy to forget, which is why both are audited.
router.put('/users/:userId/overrides', verifyToken, authorizeRoles('SuperAdmin'), authorizePermissions('rbac:manage'), rbacController.updateUserOverrides);
router.put('/users/:userId/departments', verifyToken, authorizeRoles('SuperAdmin'), authorizePermissions('rbac:manage'), rbacController.updateUserDepartments);

module.exports = router;
