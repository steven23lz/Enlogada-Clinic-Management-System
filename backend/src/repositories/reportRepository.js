const db = require('../config/database');

class ReportRepository {
  async getRevenueTrend(startDate, endDate) {
    const queryText = `
      SELECT paid_at::date as day, SUM(amount) as total
      FROM payments
      WHERE payment_status = 'Paid' AND paid_at::date BETWEEN $1 AND $2
      GROUP BY paid_at::date
      ORDER BY paid_at::date
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  async getServiceVolume(startDate, endDate) {
    const queryText = `
      SELECT tc.name as category_name, COUNT(*) as test_count
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      WHERE vt.created_at::date BETWEEN $1 AND $2
      GROUP BY tc.name
      ORDER BY test_count DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  async getVisitStatusBreakdown(startDate, endDate) {
    const queryText = `
      SELECT status, COUNT(*) as visit_count
      FROM patient_visits
      WHERE created_at::date BETWEEN $1 AND $2
      GROUP BY status
      ORDER BY status
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  async getPaymentMethodBreakdown(startDate, endDate) {
    const queryText = `
      SELECT payment_method, SUM(amount) as total, COUNT(*) as payment_count
      FROM payments
      WHERE payment_status = 'Paid' AND paid_at::date BETWEEN $1 AND $2
      GROUP BY payment_method
      ORDER BY total DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }
}

module.exports = new ReportRepository();
