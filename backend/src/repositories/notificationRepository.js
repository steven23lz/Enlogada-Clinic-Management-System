const db = require('../config/database');

// Every SELECT below aliases columns back to the original flat shape
// (id, user_id, title, message, type, is_read, created_at) that notificationService.js and the
// frontend already expect — the notification_events/notification_reads split is an internal
// storage detail, not a change to the public contract.
const SELECT_COLUMNS = `
  nr.id, nr.user_id, nr.is_read,
  ne.title, ne.message, ne.type, ne.created_at
`;

class NotificationRepository {
  async createForUsers(userIds, { title, message, type }) {
    if (!userIds || userIds.length === 0) return [];
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const eventResult = await client.query(
        `INSERT INTO notification_events (title, message, type) VALUES ($1, $2, $3) RETURNING id, created_at`,
        [title, message, type]
      );
      const event = eventResult.rows[0];
      const readsResult = await client.query(
        `INSERT INTO notification_reads (event_id, user_id)
         SELECT $1, unnest($2::int[])
         RETURNING id, user_id, is_read`,
        [event.id, userIds]
      );
      await client.query('COMMIT');
      return readsResult.rows.map((row) => ({ ...row, title, message, type, created_at: event.created_at }));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findForUser(userId, limit = 20) {
    const queryText = `
      SELECT ${SELECT_COLUMNS}
      FROM notification_reads nr
      JOIN notification_events ne ON ne.id = nr.event_id
      WHERE nr.user_id = $1
      ORDER BY ne.created_at DESC
      LIMIT $2
    `;
    const result = await db.query(queryText, [userId, limit]);
    return result.rows;
  }

  async countUnread(userId) {
    const queryText = `SELECT COUNT(*)::int as count FROM notification_reads WHERE user_id = $1 AND is_read = FALSE`;
    const result = await db.query(queryText, [userId]);
    return result.rows[0].count;
  }

  async markAsRead(id, userId) {
    const queryText = `
      UPDATE notification_reads nr
      SET is_read = TRUE
      FROM notification_events ne
      WHERE nr.id = $1 AND nr.user_id = $2 AND ne.id = nr.event_id
      RETURNING ${SELECT_COLUMNS}
    `;
    const result = await db.query(queryText, [id, userId]);
    return result.rows[0];
  }

  async markAllAsRead(userId) {
    const queryText = `UPDATE notification_reads SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`;
    await db.query(queryText, [userId]);
  }
}

module.exports = new NotificationRepository();
