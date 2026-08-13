const db = require('../config/database');

class AuditRepository {
  async create({ actorId, actorName, action, entityType, entityId, description }) {
    const queryText = `
      INSERT INTO audit_log (actor_id, actor_name, action, entity_type, entity_id, description)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const result = await db.query(queryText, [actorId || null, actorName, action, entityType, entityId || null, description]);
    return result.rows[0];
  }

  async findRecent({ limit, offset }) {
    const listQuery = `
      SELECT * FROM audit_log
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const countQuery = `SELECT COUNT(*) as count FROM audit_log`;
    const [listResult, countResult] = await Promise.all([
      db.query(listQuery, [limit, offset]),
      db.query(countQuery)
    ]);
    return {
      entries: listResult.rows,
      total: parseInt(countResult.rows[0].count, 10)
    };
  }
}

module.exports = new AuditRepository();
