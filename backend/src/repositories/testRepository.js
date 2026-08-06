const db = require('../config/database');

class TestRepository {
  async findAllTests(includeInactive = false) {
    const whereClause = includeInactive ? '' : 'WHERE t.is_active = TRUE';
    const queryText = `
      SELECT t.*, tc.name as category_name
      FROM tests t
      JOIN test_categories tc ON t.category_id = tc.id
      ${whereClause}
      ORDER BY tc.name, t.name
    `;
    const result = await db.query(queryText);
    return result.rows;
  }

  async findTestById(id) {
    const queryText = `
      SELECT t.*, tc.name as category_name
      FROM tests t
      JOIN test_categories tc ON t.category_id = tc.id
      WHERE t.id = $1
    `;
    const result = await db.query(queryText, [id]);
    return result.rows[0];
  }

  async createTest({ categoryId, name, price }) {
    const queryText = `
      INSERT INTO tests (category_id, name, price)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await db.query(queryText, [categoryId, name, price]);
    return result.rows[0];
  }

  async updateTest(id, { categoryId, name, price, isActive }) {
    const queryText = `
      UPDATE tests
      SET category_id = $1, name = $2, price = $3, is_active = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
    `;
    const result = await db.query(queryText, [categoryId, name, price, isActive, id]);
    return result.rows[0];
  }

  async updateTestPrice(id, price) {
    const queryText = `
      UPDATE tests
      SET price = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const result = await db.query(queryText, [price, id]);
    return result.rows[0];
  }

  async findAllCategories() {
    const queryText = 'SELECT * FROM test_categories ORDER BY name';
    const result = await db.query(queryText);
    return result.rows;
  }

  // Visit-Tests: Link tests to a patient visit
  async addTestToVisit({ patientVisitId, testId, priceAtTime }) {
    const queryText = `
      INSERT INTO visit_tests (patient_visit_id, test_id, price_at_time)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await db.query(queryText, [patientVisitId, testId, priceAtTime]);
    return result.rows[0];
  }

  async findTestsByVisitId(patientVisitId) {
    const queryText = `
      SELECT vt.*, t.name as test_name, tc.name as category_name
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      WHERE vt.patient_visit_id = $1
      ORDER BY tc.name, t.name
    `;
    const result = await db.query(queryText, [patientVisitId]);
    return result.rows;
  }

  async updateVisitTestStatus(visitTestId, status) {
    const queryText = `
      UPDATE visit_tests
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const result = await db.query(queryText, [status, visitTestId]);
    return result.rows[0];
  }
}

module.exports = new TestRepository();
