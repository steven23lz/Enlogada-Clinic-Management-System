const db = require('../config/database');

class RbacRepository {
  async findAllRoles() {
    const result = await db.query('SELECT * FROM roles ORDER BY id');
    return result.rows;
  }

  async findAllPermissions() {
    const result = await db.query('SELECT * FROM permissions ORDER BY module, name');
    return result.rows;
  }

  async findRolePermissionPairs() {
    const result = await db.query(`
      SELECT r.name as role_name, p.name as permission_name
      FROM role_permissions rp
      JOIN roles r ON rp.role_id = r.id
      JOIN permissions p ON rp.permission_id = p.id
    `);
    return result.rows;
  }

  async findRoleById(roleId) {
    const result = await db.query('SELECT * FROM roles WHERE id = $1', [roleId]);
    return result.rows[0];
  }

  async findPermissionIds() {
    const result = await db.query('SELECT id FROM permissions');
    return result.rows.map((r) => r.id);
  }

  // Replaces a role's entire permission set atomically — the previous implementation deleted
  // then re-inserted one row at a time with no transaction, so a failure partway through could
  // silently leave a role with zero permissions.
  /**
   * Replaces a role's permission set wholesale.
   *
   * This used to check a connection out of the pool and drive BEGIN/COMMIT by hand. That was
   * correct on its own, but it takes a *second* connection, so calling it from inside another
   * transaction would open an independent one that cannot see the caller's uncommitted writes and
   * can block on the same rows the caller already holds. Going through withTransaction means a
   * nested call joins the transaction in progress instead.
   *
   * The per-permission INSERT loop is also gone: one statement with unnest does the same work in
   * a single round trip and keeps the row lock held for less time.
   */
  async setRolePermissions(roleId, permissionIds) {
    await db.withTransaction(async () => {
      await db.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
      if (permissionIds.length > 0) {
        await db.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT $1, unnest($2::int[])`,
          [roleId, permissionIds]
        );
      }
    });
  }
}

module.exports = new RbacRepository();
