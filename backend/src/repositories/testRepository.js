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

  /**
   * Batch form of findTestById — one round trip for a whole set of ids.
   *
   * Used when attaching tests to a visit, which previously issued a findTestById per test. That
   * loop ran inside the booking transaction, holding the slot's advisory lock for the duration.
   * Ids absent from the result are simply missing; the caller compares counts to report which.
   */
  async findTestsByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const queryText = `
      SELECT t.*, tc.name as category_name
      FROM tests t
      JOIN test_categories tc ON t.category_id = tc.id
      WHERE t.id = ANY($1::int[])
    `;
    const result = await db.query(queryText, [ids.map((id) => parseInt(id, 10))]);
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

  // `preparation` is normalised to NULL when blank [1.24.0]: an empty string and "no preparation
  // needed" mean the same thing, and only one of them renders as nothing at all.
  async createTest({ categoryId, name, price, preparation = null }) {
    const queryText = `
      INSERT INTO tests (category_id, name, price, preparation)
      VALUES ($1, $2, $3, NULLIF(TRIM($4), ''))
      RETURNING *
    `;
    const result = await db.query(queryText, [categoryId, name, price, preparation]);
    return result.rows[0];
  }

  async updateTest(id, { categoryId, name, price, isActive, preparation = null }) {
    const queryText = `
      UPDATE tests
      SET category_id = $1, name = $2, price = $3, is_active = $4,
          preparation = NULLIF(TRIM($5), ''), updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
    `;
    const result = await db.query(queryText, [categoryId, name, price, isActive, preparation, id]);
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
  // ON CONFLICT DO NOTHING against uq_visit_tests_visit_test: a retried booking re-sending the
  // same tests converges on the same rows instead of failing on the unique constraint. Returns
  // undefined for a row that already existed, so callers re-read rather than trusting RETURNING.
  async addTestToVisit({ patientVisitId, testId, priceAtTime }) {
    const queryText = `
      INSERT INTO visit_tests (patient_visit_id, test_id, price_at_time)
      VALUES ($1, $2, $3)
      ON CONFLICT (patient_visit_id, test_id) DO NOTHING
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
