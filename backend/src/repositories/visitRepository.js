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

  async findActiveVisits() {
    const queryText = `
      SELECT pv.*, p.first_name, p.last_name, p.contact_number,
             pt.name as patient_type_name,
             u.first_name as created_by_first_name, u.last_name as created_by_last_name,
             pv.status as visit_status
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      JOIN patient_types pt ON p.patient_type_id = pt.id
      LEFT JOIN users u ON pv.created_by = u.id
      WHERE pv.created_at::date = CURRENT_DATE
        AND pv.status IN ('Pending', 'Processing')
      ORDER BY pv.created_at ASC
    `;
    const result = await db.query(queryText);
    const visits = result.rows;

    for (const visit of visits) {
      const testsQuery = `
        SELECT vt.id, vt.status as test_status, vt.price_at_time, t.name as test_name, tc.name as category_name
        FROM visit_tests vt
        JOIN tests t ON vt.test_id = t.id
        JOIN test_categories tc ON t.category_id = tc.id
        WHERE vt.patient_visit_id = $1
      `;
      const testsRes = await db.query(testsQuery, [visit.id]);
      visit.tests = testsRes.rows;
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
