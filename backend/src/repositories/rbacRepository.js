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

  // ── Per-account overrides [1.20.0] ─────────────────────────────────────────────────────────

  /**
   * Every staff account, with the role template it inherits, the exceptions made for it, and the
   * modalities it has been granted beyond its roles.
   *
   * One query with three aggregated sub-selects rather than N+1 per account: the SuperAdmin
   * screen lists every staff member at once and needs all of this to render a single row.
   * Clients are excluded — a patient account has no permissions to administer, and including
   * them would put the entire patient roster in an access-control dropdown.
   */
  async findManageableAccounts() {
    const result = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.status,
             COALESCE(ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles,
             COALESCE((
               SELECT JSON_AGG(JSON_BUILD_OBJECT(
                        'permissionId', up.permission_id,
                        'name', p.name,
                        'effect', up.effect,
                        'reason', up.reason
                      ) ORDER BY p.name)
                 FROM user_permissions up
                 JOIN permissions p ON p.id = up.permission_id
                WHERE up.user_id = u.id
             ), '[]'::json) AS overrides,
             COALESCE((
               SELECT ARRAY_AGG(tc.name ORDER BY tc.name)
                 FROM user_departments ud
                 JOIN test_categories tc ON tc.id = ud.category_id
                WHERE ud.user_id = u.id
             ), '{}') AS granted_departments
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = TRUE
        JOIN roles r       ON r.id = ur.role_id
       WHERE u.id IN (
               SELECT ur2.user_id FROM user_roles ur2
                 JOIN roles r2 ON r2.id = ur2.role_id
                WHERE r2.name <> 'Client' AND ur2.is_active = TRUE
             )
       GROUP BY u.id
       ORDER BY u.first_name, u.last_name
    `);
    return result.rows;
  }

  /**
   * Replaces one account's overrides wholesale, in a transaction.
   *
   * Wholesale rather than per-row for the same reason setRolePermissions is: the screen edits a
   * whole account at a time, and a partial apply would leave someone with half the access the
   * person editing believes they granted.
   */
  async setUserPermissionOverrides(userId, overrides, actorId) {
    await db.withTransaction(async () => {
      await db.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);
      if (overrides.length > 0) {
        await db.query(
          `INSERT INTO user_permissions (user_id, permission_id, effect, granted_by, reason)
           SELECT $1, x.permission_id, x.effect, $2, x.reason
             FROM UNNEST($3::int[], $4::text[], $5::text[]) AS x(permission_id, effect, reason)`,
          [
            userId,
            actorId,
            overrides.map((o) => o.permissionId),
            overrides.map((o) => o.effect),
            overrides.map((o) => o.reason || null),
          ]
        );
      }
    });
  }

  async setUserDepartments(userId, categoryIds, actorId) {
    await db.withTransaction(async () => {
      await db.query('DELETE FROM user_departments WHERE user_id = $1', [userId]);
      if (categoryIds.length > 0) {
        await db.query(
          `INSERT INTO user_departments (user_id, category_id, granted_by)
           SELECT $1, unnest($2::int[]), $3`,
          [userId, categoryIds, actorId]
        );
      }
    });
  }

  async findAllCategories() {
    const result = await db.query('SELECT id, name FROM test_categories ORDER BY name');
    return result.rows;
  }

  async findUserById(userId) {
    const result = await db.query('SELECT id, first_name, last_name FROM users WHERE id = $1', [userId]);
    return result.rows[0];
  }
}

module.exports = new RbacRepository();
