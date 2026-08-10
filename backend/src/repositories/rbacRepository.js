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
  async setRolePermissions(roleId, permissionIds) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
      for (const permId of permissionIds) {
        await client.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [roleId, permId]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = new RbacRepository();
