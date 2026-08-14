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

  /**
   * Deletes notification history past its useful life.
   *
   * This table is a fan-out: every event writes one row per recipient, so its size is
   * events x staff, not events. Nothing ever deleted from it, which meant it grew faster than
   * any other table in the schema and never stopped — a bell that shows the latest handful of
   * items was retaining years of rows to do it.
   *
   * Two different ages on purpose. A read notification has already served its entire purpose and
   * goes early. An unread one is kept longer because deleting it silently removes something a
   * user has not seen yet, but it is still not kept forever: a notification nobody opened in
   * months is not going to be opened, and keeping it only costs storage and index depth.
   *
   * Events are cleaned up once no recipient row references them; notification_reads cascades
   * from notification_events, so orphaned parents are the only ones that need removing.
   */
  async pruneOlderThan({ readAfterDays, unreadAfterDays }) {
    const readDeleted = await db.query(
      `DELETE FROM notification_reads nr
       USING notification_events ne
       WHERE ne.id = nr.event_id
         AND nr.is_read = TRUE
         AND ne.created_at < NOW() - ($1 || ' days')::interval`,
      [String(readAfterDays)]
    );

    const unreadDeleted = await db.query(
      `DELETE FROM notification_reads nr
       USING notification_events ne
       WHERE ne.id = nr.event_id
         AND ne.created_at < NOW() - ($1 || ' days')::interval`,
      [String(unreadAfterDays)]
    );

    const eventsDeleted = await db.query(
      `DELETE FROM notification_events ne
       WHERE NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.event_id = ne.id)`
    );

    return {
      readRowsDeleted: readDeleted.rowCount,
      staleRowsDeleted: unreadDeleted.rowCount,
      eventsDeleted: eventsDeleted.rowCount,
    };
  }

  async countAll() {
    const res = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM notification_events) AS events,
         (SELECT COUNT(*)::int FROM notification_reads) AS reads`
    );
    return res.rows[0];
  }
}

module.exports = new NotificationRepository();
