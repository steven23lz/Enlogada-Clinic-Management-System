const rbacService = require('../services/rbacService');

class RbacController {
  async getRolesAndPermissions(req, res, next) {
    try {
      const data = await rbacService.getRolesAndPermissions();
      return res.status(200).json({
        status: 'success',
        data
      });
    } catch (err) {
      next(err);
    }
  }

  async updateRolePermissions(req, res, next) {
    try {
      const { roleId } = req.params;
      const { permissionIds } = req.body;

      if (!Array.isArray(permissionIds)) {
        return res.status(400).json({
          status: 'error',
          message: 'permissionIds must be an array'
        });
      }

      const numericIds = permissionIds.map((id) => parseInt(id, 10));
      if (numericIds.some((id) => isNaN(id))) {
        return res.status(400).json({
          status: 'error',
          message: 'permissionIds must all be valid numeric IDs'
        });
      }

      await rbacService.updateRolePermissions(parseInt(roleId, 10), numericIds);

      return res.status(200).json({
        status: 'success',
        message: 'Role permissions updated successfully'
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new RbacController();
