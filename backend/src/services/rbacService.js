const rbacRepository = require('../repositories/rbacRepository');

class RbacService {
  async getRolesAndPermissions() {
    const [roles, permissions, pairs] = await Promise.all([
      rbacRepository.findAllRoles(),
      rbacRepository.findAllPermissions(),
      rbacRepository.findRolePermissionPairs(),
    ]);

    const rolePermissionsMap = {};
    pairs.forEach((row) => {
      if (!rolePermissionsMap[row.role_name]) {
        rolePermissionsMap[row.role_name] = [];
      }
      rolePermissionsMap[row.role_name].push(row.permission_name);
    });

    return { roles, permissions, rolePermissions: rolePermissionsMap };
  }

  async updateRolePermissions(roleId, permissionIds) {
    const role = await rbacRepository.findRoleById(roleId);
    if (!role) {
      const error = new Error('Role not found');
      error.statusCode = 404;
      throw error;
    }

    const validPermissionIds = await rbacRepository.findPermissionIds();
    const invalidIds = permissionIds.filter((id) => !validPermissionIds.includes(id));
    if (invalidIds.length > 0) {
      const error = new Error(`Unknown permission ID(s): ${invalidIds.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }

    await rbacRepository.setRolePermissions(roleId, permissionIds);
  }
}

module.exports = new RbacService();
