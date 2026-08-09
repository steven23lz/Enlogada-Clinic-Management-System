const db = require('../config/database');

class PasswordResetRepository {
  async deleteAllForUser(userId) {
    await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
  }

  async createToken(userId, tokenHash, expiresAt) {
    const queryText = `
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
      RETURNING id, user_id, expires_at
    `;
    const result = await db.query(queryText, [userId, tokenHash, expiresAt]);
    return result.rows[0];
  }

  async findValidByTokenHash(tokenHash) {
    const queryText = `
      SELECT *
      FROM password_reset_tokens
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
    `;
    const result = await db.query(queryText, [tokenHash]);
    return result.rows[0];
  }

  async markUsed(id) {
    await db.query('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
  }
}

module.exports = new PasswordResetRepository();
