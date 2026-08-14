const db = require('../config/database');

/**
 * Join condition for a role grant that is in force *right now*.
 *
 * user_roles has carried starts_at and expires_at since the original schema, and nothing read
 * either one — the join checked only is_active. So a deliberately time-bounded grant ("give the
 * locum Xray Staff until the 30th") never actually ended: the role kept coming back from these
 * queries, kept landing in req.user.roles, and kept being honoured by authorizeRoles, forever.
 *
 * That is the worst shape for an access control to have. A column that looks like it enforces
 * something and does not is more dangerous than no column at all, because whoever set the expiry
 * date reasonably believes access is bounded and stops thinking about it.
 *
 * This is also the one revocation path that the per-request authorization work did not already
 * cover: that change made role *removal* take effect immediately, while expiry-based revocation
 * still silently never fired.
 */
const ACTIVE_ROLE_GRANT = `
  ur.is_active = TRUE
  AND (ur.starts_at  IS NULL OR ur.starts_at  <= NOW())
  AND (ur.expires_at IS NULL OR ur.expires_at >  NOW())
`;

class UserRepository {
  async findByEmail(email) {
    const queryText = `
      SELECT u.*, 
             COALESCE(ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') as roles,
             COALESCE(ARRAY_AGG(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL), '{}') as permissions
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id AND ${ACTIVE_ROLE_GRANT}
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
             u.avatar_path, u.password_changed_at,
             COALESCE(ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') as roles,
             COALESCE(ARRAY_AGG(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL), '{}') as permissions
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id AND ${ACTIVE_ROLE_GRANT}
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

  /**
   * Sets a new password and stamps when it changed.
   *
   * password_changed_at is what makes a password change actually end existing sessions —
   * verifyToken rejects any token issued before it. Every path that changes a password goes
   * through here (self-service change, emailed reset, and an administrator resetting a staff
   * member's password), so revocation cannot be forgotten by one of them.
   */
  async updatePasswordHash(userId, passwordHash) {
    const queryText = `
      UPDATE users
      SET password_hash = $1,
          password_changed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, email
    `;
    const result = await db.query(queryText, [passwordHash, userId]);
    return result.rows[0];
  }

  async updateContactInfo(userId, firstName, lastName, contactNumber) {
    const queryText = `
      UPDATE users
      SET first_name = $1, last_name = $2, contact_number = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING id, first_name, last_name, email, contact_number, status, created_at
    `;
    const result = await db.query(queryText, [firstName, lastName, contactNumber, userId]);
    return result.rows[0];
  }

  // UI/UX Modernization Phase 11: unlike updateContactInfo (self-service, email deliberately
  // excluded — "your email is your login and cannot be changed here"), this is Admin editing
  // someone else's staff record, where correcting a typo'd email at creation time is legitimate.
  // Role is never touched here — reassigning a role is a separate, more sensitive surface.
  async updateStaffDetails(userId, { firstName, lastName, email, contactNumber }) {
    const queryText = `
      UPDATE users
      SET first_name = $1, last_name = $2, email = $3, contact_number = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING id, first_name, last_name, email, contact_number, status, created_at
    `;
    const result = await db.query(queryText, [firstName, lastName, email, contactNumber, userId]);
    return result.rows[0];
  }

  async findPasswordHashById(userId) {
    const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.password_hash;
  }

  async findStaffUsers(roleNames) {
    const queryText = `
      SELECT u.id, u.first_name, u.last_name, u.email, u.contact_number, u.status, u.created_at,
             COALESCE(ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') as roles
      FROM users u
      JOIN user_roles ur ON u.id = ur.user_id AND ur.is_active = TRUE
      JOIN roles r ON ur.role_id = r.id
      WHERE r.name = ANY($1::text[])
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `;
    const result = await db.query(queryText, [roleNames]);
    return result.rows;
  }

  async updateUserStatus(userId, status) {
    const queryText = `
      UPDATE users
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, first_name, last_name, email, status
    `;
    const result = await db.query(queryText, [status, userId]);
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

  // Returns the *previous* avatar_path (before overwrite) so the service can delete the stale
  // file from disk — a replace, not an append, since only one avatar exists per user at a time.
  async replaceAvatar(userId, avatarPath, avatarMimeType) {
    const queryText = `
      WITH old AS (SELECT avatar_path FROM users WHERE id = $3)
      UPDATE users
      SET avatar_path = $1, avatar_mime_type = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING (SELECT avatar_path FROM old) AS previous_avatar_path
    `;
    const result = await db.query(queryText, [avatarPath, avatarMimeType, userId]);
    return result.rows[0]?.previous_avatar_path;
  }

  async clearAvatar(userId) {
    // RETURNING reflects the row *after* the update, so avatar_path would already be NULL by
    // then — the old-value CTE (same trick as replaceAvatar above) is what actually captures
    // the path to delete from disk.
    const queryText = `
      WITH old AS (SELECT avatar_path FROM users WHERE id = $1)
      UPDATE users
      SET avatar_path = NULL, avatar_mime_type = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING (SELECT avatar_path FROM old) AS previous_avatar_path
    `;
    const result = await db.query(queryText, [userId]);
    return result.rows[0]?.previous_avatar_path;
  }

  async findAvatarById(userId) {
    const result = await db.query('SELECT avatar_path, avatar_mime_type FROM users WHERE id = $1', [userId]);
    return result.rows[0];
  }
}

module.exports = new UserRepository();
