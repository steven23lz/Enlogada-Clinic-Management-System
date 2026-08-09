const db = require('../config/database');

class UserRepository {
  async findByEmail(email) {
    const queryText = `
      SELECT u.*, 
             COALESCE(ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') as roles,
             COALESCE(ARRAY_AGG(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL), '{}') as permissions
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id AND ur.is_active = TRUE
      LEFT JOIN roles r ON ur.role_id = r.id
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      LEFT JOIN permissions p ON rp.permission_id = p.id
      WHERE u.email = $1
      GROUP BY u.id
    `;
    const result = await db.query(queryText, [email]);
    return result.rows[0];
  }

  async findById(id) {
    const queryText = `
      SELECT u.id, u.first_name, u.last_name, u.email, u.contact_number, u.status, u.created_at, 
             COALESCE(ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') as roles,
             COALESCE(ARRAY_AGG(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL), '{}') as permissions
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id AND ur.is_active = TRUE
      LEFT JOIN roles r ON ur.role_id = r.id
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      LEFT JOIN permissions p ON rp.permission_id = p.id
      WHERE u.id = $1
      GROUP BY u.id
    `;
    const result = await db.query(queryText, [id]);
    return result.rows[0];
  }

  async createUser(firstName, lastName, email, passwordHash, contactNumber) {
    const queryText = `
      INSERT INTO users (first_name, last_name, email, password_hash, contact_number)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, first_name, last_name, email, contact_number, status, created_at
    `;
    const result = await db.query(queryText, [firstName, lastName, email, passwordHash, contactNumber]);
    return result.rows[0];
  }

  async updatePasswordHash(userId, passwordHash) {
    const queryText = `
      UPDATE users
      SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, email
    `;
    const result = await db.query(queryText, [passwordHash, userId]);
    return result.rows[0];
  }

  async findRoleIdByName(roleName) {
    const queryText = 'SELECT id FROM roles WHERE name = $1';
    const result = await db.query(queryText, [roleName]);
    return result.rows[0]?.id;
  }

  async assignRoleToUser(userId, roleId, assignedBy = null) {
    const queryText = `
      INSERT INTO user_roles (user_id, role_id, assigned_by)
      VALUES ($1, $2, $3)
      RETURNING id, user_id, role_id
    `;
    const result = await db.query(queryText, [userId, roleId, assignedBy]);
    return result.rows[0];
  }
}

module.exports = new UserRepository();
