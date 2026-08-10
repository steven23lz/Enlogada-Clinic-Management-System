const db = require('../config/database');

class VisitRepository {
  async createVisit({ patientId, visitType, notes, queueNumber, createdBy }, client = db) {
    const queryText = `
      INSERT INTO patient_visits (patient_id, visit_type, notes, queue_number, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await client.query(queryText, [patientId, visitType, notes, queueNumber, createdBy]);
    return result.rows[0];
  }

  // search/status/limit/offset are all optional. Omitting limit preserves the original
  // "return everything matching" behavior for callers (e.g. Cashier's billing queue) that need
  // to see every unpaid visit at once, not just one page of it. Callers that do paginate
  // (Receptionist's queue table) get total/pendingCount/processingCount/walkinCount back too,
  // computed server-side, so pagination doesn't break their KPI header cards.
  async findActiveVisits({ search, status, limit, offset } = {}) {
    const filters = [`pv.created_at::date = CURRENT_DATE`, `pv.status IN ('Pending', 'Processing')`];
    const params = [];

    if (status && status !== 'All') {
      params.push(status);
      filters.push(`pv.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      filters.push(`(p.first_name ILIKE $${idx} OR p.last_name ILIKE $${idx} OR pv.queue_number ILIKE $${idx})`);
    }
    const whereClause = filters.join(' AND ');

    const summaryQuery = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE pv.status = 'Pending') as pending_count,
        COUNT(*) FILTER (WHERE pv.status = 'Processing') as processing_count,
        COUNT(*) FILTER (WHERE pv.visit_type = 'Walk in') as walkin_count
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      WHERE ${whereClause}
    `;
    const summaryRes = await db.query(summaryQuery, params);
    const summary = summaryRes.rows[0];

    let listQuery = `
      SELECT pv.*, p.first_name, p.last_name, p.contact_number,
             pt.name as patient_type_name,
             u.first_name as created_by_first_name, u.last_name as created_by_last_name,
             pv.status as visit_status
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      JOIN patient_types pt ON p.patient_type_id = pt.id
      LEFT JOIN users u ON pv.created_by = u.id
      WHERE ${whereClause}
      ORDER BY pv.created_at ASC
    `;
    const listParams = [...params];
    if (limit != null) {
      listParams.push(limit);
      listQuery += ` LIMIT $${listParams.length}`;
      if (offset != null) {
        listParams.push(offset);
        listQuery += ` OFFSET $${listParams.length}`;
      }
    }
    const result = await db.query(listQuery, listParams);
    const visits = result.rows;

    // Batch-fetch tests for every visit on this page in one query instead of one query per
    // visit — the previous per-visit loop here was a genuine N+1 (confirmed as the cause of a
    // multi-second load once the daily active-visit count grew large during the UI/UX audit).
    if (visits.length > 0) {
      const testsQuery = `
        SELECT vt.id, vt.patient_visit_id, vt.status as test_status, vt.price_at_time, t.name as test_name, tc.name as category_name
        FROM visit_tests vt
        JOIN tests t ON vt.test_id = t.id
        JOIN test_categories tc ON t.category_id = tc.id
        WHERE vt.patient_visit_id = ANY($1::int[])
      `;
      const testsRes = await db.query(testsQuery, [visits.map(v => v.id)]);
      const testsByVisit = {};
      for (const row of testsRes.rows) {
        if (!testsByVisit[row.patient_visit_id]) testsByVisit[row.patient_visit_id] = [];
        testsByVisit[row.patient_visit_id].push(row);
      }
      for (const visit of visits) {
        visit.tests = testsByVisit[visit.id] || [];
      }
    }

    return {
      visits,
      total: parseInt(summary.total, 10),
      pendingCount: parseInt(summary.pending_count, 10),
      processingCount: parseInt(summary.processing_count, 10),
      walkinCount: parseInt(summary.walkin_count, 10),
    };
  }

  // Any-status, date-ranged visit lookup for Receptionist's Visit History view — distinct from
  // findActiveVisits (today-only, Pending/Processing only). Defaults are applied by the service
  // layer, not here, matching paymentRepository.findTransactions' convention.
  async findVisitsByDateRange({ startDate, endDate, search }) {
    const filters = [`pv.created_at::date BETWEEN $1 AND $2`];
    const params = [startDate, endDate];

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      filters.push(`(p.first_name ILIKE $${idx} OR p.last_name ILIKE $${idx} OR pv.queue_number ILIKE $${idx})`);
    }
    const whereClause = filters.join(' AND ');

    const listQuery = `
      SELECT pv.*, p.first_name, p.last_name, p.contact_number,
             pt.name as patient_type_name,
             pv.status as visit_status
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      JOIN patient_types pt ON p.patient_type_id = pt.id
      WHERE ${whereClause}
      ORDER BY pv.created_at DESC
    `;
    const result = await db.query(listQuery, params);
    const visits = result.rows;

    if (visits.length > 0) {
      const testsQuery = `
        SELECT vt.id, vt.patient_visit_id, vt.status as test_status, t.name as test_name, tc.name as category_name
        FROM visit_tests vt
        JOIN tests t ON vt.test_id = t.id
        JOIN test_categories tc ON t.category_id = tc.id
        WHERE vt.patient_visit_id = ANY($1::int[])
      `;
      const testsRes = await db.query(testsQuery, [visits.map(v => v.id)]);
      const testsByVisit = {};
      for (const row of testsRes.rows) {
        if (!testsByVisit[row.patient_visit_id]) testsByVisit[row.patient_visit_id] = [];
        testsByVisit[row.patient_visit_id].push(row);
      }
      for (const visit of visits) {
        visit.tests = testsByVisit[visit.id] || [];
      }
    }

    return visits;
  }

  async findVisitById(id) {
    const queryText = `
      SELECT pv.*, p.first_name, p.last_name, p.contact_number,
             pt.name as patient_type_name
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      JOIN patient_types pt ON p.patient_type_id = pt.id
      WHERE pv.id = $1
    `;
    const result = await db.query(queryText, [id]);
    return result.rows[0];
  }

  async updateVisitStatus(id, status) {
    const queryText = `
      UPDATE patient_visits
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const result = await db.query(queryText, [status, id]);
    return result.rows[0];
  }

  async findVisitsByPatientId(patientId) {
    const queryText = `
      SELECT pv.*, p.first_name, p.last_name
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      WHERE pv.patient_id = $1
      ORDER BY pv.created_at DESC
    `;
    const result = await db.query(queryText, [patientId]);
    return result.rows;
  }

  async getNextQueueNumber(client = db) {
    const queryText = `
      SELECT COUNT(*) as count
      FROM patient_visits
      WHERE created_at::date = CURRENT_DATE
    `;
    const result = await client.query(queryText);
    const count = parseInt(result.rows[0].count, 10);
    return String(count + 1).padStart(4, '0');
  }
}

module.exports = new VisitRepository();
