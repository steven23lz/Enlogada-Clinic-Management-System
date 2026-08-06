const db = require('../config/database');

class RbacController {
  async getRolesAndPermissions(req, res, next) {
    try {
      const rolesRes = await db.query('SELECT * FROM roles ORDER BY id');
      const permsRes = await db.query('SELECT * FROM permissions ORDER BY module, name');
      const rolePermsRes = await db.query(`
        SELECT r.name as role_name, p.name as permission_name 
        FROM role_permissions rp
        JOIN roles r ON rp.role_id = r.id
        JOIN permissions p ON rp.permission_id = p.id
      `);

      const rolePermissionsMap = {};
      rolePermsRes.rows.forEach(row => {
        if (!rolePermissionsMap[row.role_name]) {
          rolePermissionsMap[row.role_name] = [];
        }
        rolePermissionsMap[row.role_name].push(row.permission_name);
      });

      return res.status(200).json({
        status: 'success',
        data: {
          roles: rolesRes.rows,
          permissions: permsRes.rows,
          rolePermissions: rolePermissionsMap
        }
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

      await db.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);

      for (const permId of permissionIds) {
        await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [roleId, permId]);
      }

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
