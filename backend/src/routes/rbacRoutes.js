const express = require('express');
const router = express.Router();
const rbacController = require('../controllers/rbacController');
const { verifyToken, authorizeRoles } = require('../middlewares/auth');

router.get('/matrix', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), rbacController.getRolesAndPermissions);
router.put('/roles/:roleId/permissions', verifyToken, authorizeRoles('SuperAdmin', 'Admin'), rbacController.updateRolePermissions);

module.exports = router;
