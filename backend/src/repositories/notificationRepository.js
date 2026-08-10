const db = require('../config/database');

class NotificationRepository {
  async createForUsers(userIds, { title, message, type }) {
    if (!userIds || userIds.length === 0) return [];
    const queryText = `
      INSERT INTO notifications (user_id, title, message, type)
      SELECT unnest($1::int[]), $2, $3, $4
      RETURNING *
    `;
    const result = await db.query(queryText, [userIds, title, message, type]);
    return result.rows;
  }

  async findForUser(userId, limit = 20) {
    const queryText = `
      SELECT * FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const result = await db.query(queryText, [userId, limit]);
    return result.rows;
  }

  async countUnread(userId) {
    const queryText = `SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1 AND is_read = FALSE`;
    const result = await db.query(queryText, [userId]);
    return result.rows[0].count;
  }

  async markAsRead(id, userId) {
    const queryText = `
      UPDATE notifications
      SET is_read = TRUE
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `;
    const result = await db.query(queryText, [id, userId]);
    return result.rows[0];
  }

  async markAllAsRead(userId) {
    const queryText = `UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`;
    await db.query(queryText, [userId]);
  }
}

module.exports = new NotificationRepository();
