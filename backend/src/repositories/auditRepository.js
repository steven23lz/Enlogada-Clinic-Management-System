const db = require('../config/database');

/**
 * Entries a migration wrote to keep data it was about to drop. [1.111.0]
 *
 * They are RECORDS, not activity: nobody did anything at the moment they were written, and one
 * removal can write dozens — [1.109.0] wrote one per typed result, burying a morning of refunds
 * and corrections under "Typed values of result #…". Hidden from the activity feed by default and
 * shown on request, never deleted: on the clinic's database they are the only remaining copy of
 * what the dropped tables held.
 */
const ARCHIVE_ACTIONS = ['result.measurements_archived', 'clinic.signatory_archived', 'result.critical_flag_retired'];

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

  /**
   * The newest entry of each action about one kind of thing with no id of its own: the backups.
   * [1.148.0] `entity_id IS NULL` keeps it on idx_audit_log_entity_created.
   */
  async findLatestForEntityType(entityType, actions) {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (action) action, created_at, description
         FROM audit_log
        WHERE entity_type = $1 AND entity_id IS NULL AND action = ANY($2::text[])
        ORDER BY action, created_at DESC`,
      [entityType, actions]
    );
    return Object.fromEntries(rows.map((r) => [r.action, r]));
  }

  /**
   * Retention, in two windows: PHI reads after `phiDays`, everything else after `otherDays`, and
   * never a migration archive (ARCHIVE_ACTIONS: the only copy of what a dropped table held).
   * [1.148.0] Moved here from scripts/pruneAuditLog.js so the server's own retention pass and the
   * script delete exactly the same rows.
   */
  async countPastRetention({ phiDays, otherDays }) {
    const { rows } = await db.query(
      `SELECT COUNT(*) FILTER (WHERE action LIKE 'phi.read.%' AND created_at < NOW() - ($1 || ' days')::interval)::int AS phi,
              COUNT(*) FILTER (WHERE action NOT LIKE 'phi.read.%' AND created_at < NOW() - ($2 || ' days')::interval)::int AS other
         FROM audit_log
        WHERE created_at < NOW() - (LEAST($1::int, $2::int) || ' days')::interval
          AND action <> ALL($3::text[])`,
      [String(phiDays), String(otherDays), ARCHIVE_ACTIONS]
    );
    return rows[0];
  }

  async deletePastRetention({ phiDays, otherDays }) {
    const { rowCount } = await db.query(
      `DELETE FROM audit_log
        WHERE action <> ALL($3::text[])
          AND ((action LIKE 'phi.read.%' AND created_at < NOW() - ($1 || ' days')::interval)
            OR (action NOT LIKE 'phi.read.%' AND created_at < NOW() - ($2 || ' days')::interval))`,
      [String(phiDays), String(otherDays), ARCHIVE_ACTIONS]
    );
    return rowCount;
  }

  async countAll() {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE action LIKE 'phi.read.%')::int AS phi FROM audit_log`
    );
    return rows[0];
  }

  async findRecent({ limit, offset, includeArchives = false }) {
    // The same filter on the list and the count, so the pages add up to the total shown.
    const where = includeArchives ? '' : 'WHERE action <> ALL($1::text[])';
    const params = includeArchives ? [] : [ARCHIVE_ACTIONS];
    const listQuery = `
      SELECT * FROM audit_log
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const countQuery = `SELECT COUNT(*) as count FROM audit_log ${where}`;
    const [listResult, countResult] = await Promise.all([
      db.query(listQuery, [...params, limit, offset]),
      db.query(countQuery, params)
    ]);
    return {
      entries: listResult.rows,
      total: parseInt(countResult.rows[0].count, 10)
    };
  }
}

module.exports = new AuditRepository();
