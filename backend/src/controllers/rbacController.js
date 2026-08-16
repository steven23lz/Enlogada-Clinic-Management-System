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

  /**
   * PUT /rbac/users/:userId/overrides — the exceptions made for one named account. [1.20.0]
   *
   * Body: { overrides: [{ permissionId, effect: 'grant' | 'revoke', reason? }] }
   * Sending [] clears every exception, returning the account to exactly its role template.
   */
  async updateUserOverrides(req, res, next) {
    try {
      const userId = parseInt(req.params.userId, 10);
      const { overrides } = req.body;

      if (!Number.isInteger(userId)) {
        return res.status(400).json({ status: 'error', message: 'userId must be a numeric ID' });
      }
      if (!Array.isArray(overrides)) {
        return res.status(400).json({ status: 'error', message: 'overrides must be an array' });
      }

      const normalised = overrides.map((o) => ({
        permissionId: parseInt(o?.permissionId, 10),
        effect: o?.effect,
        reason: typeof o?.reason === 'string' ? o.reason.trim().slice(0, 500) : null,
      }));
      if (normalised.some((o) => !Number.isInteger(o.permissionId))) {
        return res.status(400).json({ status: 'error', message: 'Each override needs a numeric permissionId' });
      }

      await rbacService.setUserOverrides(userId, normalised, req.user);
      return res.status(200).json({ status: 'success', message: 'Account permissions updated' });
    } catch (err) {
      next(err);
    }
  }

  /** PUT /rbac/users/:userId/departments — extra modalities beyond what the roles imply. */
  async updateUserDepartments(req, res, next) {
    try {
      const userId = parseInt(req.params.userId, 10);
      const { categoryIds } = req.body;

      if (!Number.isInteger(userId)) {
        return res.status(400).json({ status: 'error', message: 'userId must be a numeric ID' });
      }
      if (!Array.isArray(categoryIds)) {
        return res.status(400).json({ status: 'error', message: 'categoryIds must be an array' });
      }

      const numericIds = categoryIds.map((id) => parseInt(id, 10));
      if (numericIds.some((id) => !Number.isInteger(id))) {
        return res.status(400).json({ status: 'error', message: 'categoryIds must all be numeric IDs' });
      }

      await rbacService.setUserDepartments(userId, numericIds, req.user);
      return res.status(200).json({ status: 'success', message: 'Account department access updated' });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new RbacController();
