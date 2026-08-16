const rbacRepository = require('../repositories/rbacRepository');
const auditService = require('./auditService');
const { STAFF_ROLE_TO_CATEGORIES, departmentsForUser } = require('../constants/modality');

class RbacService {
  async getRolesAndPermissions() {
    const [roles, permissions, pairs, accounts, categories] = await Promise.all([
      rbacRepository.findAllRoles(),
      rbacRepository.findAllPermissions(),
      rbacRepository.findRolePermissionPairs(),
      rbacRepository.findManageableAccounts(),
      rbacRepository.findAllCategories(),
    ]);

    const rolePermissionsMap = {};
    pairs.forEach((row) => {
      if (!rolePermissionsMap[row.role_name]) {
        rolePermissionsMap[row.role_name] = [];
      }
      rolePermissionsMap[row.role_name].push(row.permission_name);
    });

    // Each account arrives with its role template, its exceptions, and the result of applying one
    // to the other. The screen needs all three: "Cashier gives them this, we granted that, so the
    // answer is this" is the sentence a person editing access has to be able to read off the
    // page. Computing only the effective set would make an override invisible once applied.
    const enrichedAccounts = accounts.map((account) => {
      const fromRoles = new Set();
      (account.roles || []).forEach((role) => {
        (rolePermissionsMap[role] || []).forEach((p) => fromRoles.add(p));
      });

      const overrides = account.overrides || [];
      const granted = overrides.filter((o) => o.effect === 'grant').map((o) => o.name);
      const revoked = new Set(overrides.filter((o) => o.effect === 'revoke').map((o) => o.name));

      const effective = new Set([...fromRoles, ...granted]);
      revoked.forEach((p) => effective.delete(p));

      // Departments implied by the roles, shown separately from the ones granted directly, so it
      // is obvious which ticks are inherited and which are this account's own.
      const roleDepartments = new Set();
      (account.roles || []).forEach((role) => {
        (STAFF_ROLE_TO_CATEGORIES[role] || []).forEach((c) => roleDepartments.add(c));
      });

      return {
        id: account.id,
        firstName: account.first_name,
        lastName: account.last_name,
        email: account.email,
        status: account.status,
        roles: account.roles || [],
        rolePermissions: [...fromRoles].sort(),
        overrides,
        effectivePermissions: [...effective].sort(),
        roleDepartments: [...roleDepartments].sort(),
        grantedDepartments: account.granted_departments || [],
        effectiveDepartments: departmentsForUser({
          roles: account.roles || [],
          granted_departments: account.granted_departments || [],
        }),
      };
    });

    return {
      roles,
      permissions,
      rolePermissions: rolePermissionsMap,
      accounts: enrichedAccounts,
      categories,
    };
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

  /**
   * Replaces one account's permission exceptions. [1.20.0]
   *
   * Audited, unlike role edits were. An override is a deliberate departure from the standard for
   * one named person, which is exactly the change a reviewer will later want explained — and the
   * only one where "who decided this, and when" is not recoverable from the role template.
   */
  async setUserOverrides(userId, overrides, actor) {
    const target = await rbacRepository.findUserById(userId);
    if (!target) {
      const error = new Error('Account not found');
      error.statusCode = 404;
      throw error;
    }

    const validPermissionIds = await rbacRepository.findPermissionIds();
    const invalid = overrides.filter((o) => !validPermissionIds.includes(o.permissionId));
    if (invalid.length > 0) {
      const error = new Error(`Unknown permission ID(s): ${invalid.map((o) => o.permissionId).join(', ')}`);
      error.statusCode = 400;
      throw error;
    }

    const badEffect = overrides.find((o) => o.effect !== 'grant' && o.effect !== 'revoke');
    if (badEffect) {
      const error = new Error("Each override's effect must be 'grant' or 'revoke'");
      error.statusCode = 400;
      throw error;
    }

    await rbacRepository.setUserPermissionOverrides(userId, overrides, actor.userId);

    const grants = overrides.filter((o) => o.effect === 'grant').length;
    const revokes = overrides.length - grants;
    await auditService.log({
      actorId: actor.userId,
      action: 'rbac.user_overrides_set',
      entityType: 'user',
      entityId: userId,
      description: `Set permission exceptions for ${target.first_name} ${target.last_name}: ${grants} granted, ${revokes} revoked`,
    });
  }

  /** Replaces the modalities granted to one account beyond what its roles already imply. */
  async setUserDepartments(userId, categoryIds, actor) {
    const target = await rbacRepository.findUserById(userId);
    if (!target) {
      const error = new Error('Account not found');
      error.statusCode = 404;
      throw error;
    }

    const categories = await rbacRepository.findAllCategories();
    const validIds = categories.map((c) => c.id);
    const invalid = categoryIds.filter((id) => !validIds.includes(id));
    if (invalid.length > 0) {
      const error = new Error(`Unknown department ID(s): ${invalid.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }

    await rbacRepository.setUserDepartments(userId, categoryIds, actor.userId);

    const names = categories.filter((c) => categoryIds.includes(c.id)).map((c) => c.name);
    await auditService.log({
      actorId: actor.userId,
      action: 'rbac.user_departments_set',
      entityType: 'user',
      entityId: userId,
      description: `Set extra department access for ${target.first_name} ${target.last_name}: ${names.length ? names.join(', ') : 'none'}`,
    });
  }
}

module.exports = new RbacService();
