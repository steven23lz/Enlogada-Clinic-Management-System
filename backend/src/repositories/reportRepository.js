const db = require('../config/database');

class ReportRepository {
  async getRevenueTrend(startDate, endDate) {
    const queryText = `
      SELECT paid_at::date as day, SUM(amount) as total
      FROM payments
      WHERE payment_status = 'Paid' AND paid_at >= $1::date AND paid_at < ($2::date + 1)
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
      WHERE vt.created_at >= $1::date AND vt.created_at < ($2::date + 1)
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
      WHERE created_at >= $1::date AND created_at < ($2::date + 1)
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
      WHERE payment_status = 'Paid' AND paid_at >= $1::date AND paid_at < ($2::date + 1)
      GROUP BY payment_method
      ORDER BY total DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  // Feature Gap Plan Phase D: staff workload visibility existed for Cashier only
  // (CashierMonitoring.jsx's own byCashier, computed client-side from transactions). These two
  // mirror that pattern server-side for Reception and Diagnostic, the two departments Admin had
  // no per-staff throughput view for at all.
  async getReceptionWorkload(startDate, endDate) {
    const queryText = `
      SELECT u.id as staff_id, u.first_name, u.last_name, COUNT(*) as visit_count
      FROM patient_visits pv
      JOIN users u ON pv.created_by = u.id
      WHERE pv.created_at >= $1::date AND pv.created_at < ($2::date + 1)
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY visit_count DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  async getDiagnosticWorkload(startDate, endDate) {
    const queryText = `
      SELECT u.id as staff_id, u.first_name, u.last_name, tc.name as category_name, COUNT(*) as result_count
      FROM test_results tr
      JOIN users u ON tr.released_by = u.id
      JOIN visit_tests vt ON tr.visit_test_id = vt.id
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      -- is_current: an amended result would otherwise count once per version, inflating a
      -- clinician's throughput every time somebody corrected a report.
      WHERE tr.is_current
        AND tr.released_at >= $1::date AND tr.released_at < ($2::date + 1)
      GROUP BY u.id, u.first_name, u.last_name, tc.name
      ORDER BY result_count DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }
}

module.exports = new ReportRepository();
