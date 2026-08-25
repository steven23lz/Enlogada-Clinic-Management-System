const express = require('express');
const router = express.Router();
const rbacController = require('../controllers/rbacController');
const { verifyToken, authorizeStaff, authorizeRoles, authorizePermissions } = require('../middlewares/auth');

// Reading the matrix is SuperAdmin's, on the same permission that edits it.
//
// It used to name ('SuperAdmin', 'Admin') so that Module 12's dashboard could count roles for a
// stat card — a card that has since been replaced by one an Admin can actually read. What the
// role list left behind was an Admin who could enumerate every role, every permission and exactly
// which of them they themselves were missing: the reconnaissance half of privilege escalation,
// available to the one role positioned to attempt it.
//
// Deliberately `rbac:manage` rather than a new `rbac:read`. Seeing the access matrix IS part of
// administering access, and a separate permission would have to be granted alongside it every
// time — the first omission produces a SuperAdmin who can edit a matrix they cannot open. Same
// reasoning as packages sharing `tests:manage` [1.47.0].
router.get('/matrix', verifyToken, authorizeStaff, authorizePermissions('rbac:manage'), rbacController.getRolesAndPermissions);
router.put('/roles/:roleId/permissions', verifyToken, authorizeRoles('SuperAdmin'), authorizePermissions('rbac:manage'), rbacController.updateRolePermissions);

// Per-account exceptions and department assignment. [1.20.0]
//
// Same gate as editing a role, and for the same reason: this decides who may do what. It is if
// anything the sharper of the two — a role edit is visible in the matrix everyone reads, while an
// exception applies to one person and is easy to forget, which is why both are audited.
router.put('/users/:userId/overrides', verifyToken, authorizeRoles('SuperAdmin'), authorizePermissions('rbac:manage'), rbacController.updateUserOverrides);
router.put('/users/:userId/departments', verifyToken, authorizeRoles('SuperAdmin'), authorizePermissions('rbac:manage'), rbacController.updateUserDepartments);

module.exports = router;
