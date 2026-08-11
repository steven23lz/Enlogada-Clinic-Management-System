const db = require('../config/database');

class PaymentRepository {
  async createPayment({ patientVisitId, processedBy, paymentMethod, referenceNumber, receiptNumber, amount }) {
    const queryText = `
      INSERT INTO payments (patient_visit_id, processed_by, payment_method, reference_number, receipt_number, amount)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const result = await db.query(queryText, [
      patientVisitId, processedBy, paymentMethod, referenceNumber, receiptNumber, amount
    ]);
    return result.rows[0];
  }

  async findPaymentsByVisitId(patientVisitId) {
    const queryText = `
      SELECT pay.*, u.first_name as processed_by_first_name, u.last_name as processed_by_last_name
      FROM payments pay
      LEFT JOIN users u ON pay.processed_by = u.id
      WHERE pay.patient_visit_id = $1
      ORDER BY pay.paid_at DESC
    `;
    const result = await db.query(queryText, [patientVisitId]);
    return result.rows;
  }

  async findTransactions({ startDate, endDate }) {
    let queryText = `
      SELECT pay.*, 
             u.first_name as processed_by_first_name, u.last_name as processed_by_last_name,
             p.first_name as patient_first_name, p.last_name as patient_last_name,
             pv.queue_number
      FROM payments pay
      LEFT JOIN users u ON pay.processed_by = u.id
      JOIN patient_visits pv ON pay.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
    `;
    const params = [];

    if (startDate && endDate) {
      queryText += ' WHERE pay.paid_at::date BETWEEN $1 AND $2';
      params.push(startDate, endDate);
    } else {
      queryText += ' WHERE pay.paid_at::date = CURRENT_DATE';
    }

    queryText += ' ORDER BY pay.paid_at DESC';
    const result = await db.query(queryText, params);
    return result.rows;
  }

  async getBillingSummary(patientVisitId) {
    const visitQuery = `
      SELECT pv.id, p.first_name, p.last_name, pt.name as patient_type_name
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      JOIN patient_types pt ON p.patient_type_id = pt.id
      WHERE pv.id = $1
    `;
    const visitResult = await db.query(visitQuery, [patientVisitId]);

    // Correlated subquery (not a LEFT JOIN) for hmo_approval_status: a visit_test could in
    // principle be linked to more than one hmo_request_tests row (no constraint prevents it
    // across different HMO requests), and a JOIN would then duplicate that test's line item,
    // silently inflating the bill subtotal. The subquery guarantees exactly one row per test,
    // taking the most recent linked request if more than one exists.
    const itemsQuery = `
      SELECT vt.id as visit_test_id, vt.price_at_time, vt.status,
             t.name as test_name, tc.name as category_name,
             (
               SELECT hrt.approval_status
               FROM hmo_request_tests hrt
               WHERE hrt.visit_test_id = vt.id
               ORDER BY hrt.created_at DESC
               LIMIT 1
             ) as hmo_approval_status
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      WHERE vt.patient_visit_id = $1
      ORDER BY tc.name, t.name
    `;
    const itemsResult = await db.query(itemsQuery, [patientVisitId]);

    return {
      visitInfo: visitResult.rows[0],
      items: itemsResult.rows
    };
  }

  // Module 14's "Client-side payment visibility" — aggregates across all of the client's own
  // patient profiles/dependents, matching the same pattern already used by
  // appointmentRepository.findByPatientUserId and patientRepository.findPatientsByUserId.
  async findPaymentsByPatientUserId(userId) {
    const queryText = `
      SELECT pay.*, p.first_name as patient_first_name, p.last_name as patient_last_name,
             pv.queue_number, pv.visit_type
      FROM payments pay
      JOIN patient_visits pv ON pay.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE p.user_id = $1
      ORDER BY pay.paid_at DESC
    `;
    const result = await db.query(queryText, [userId]);
    return result.rows;
  }

  async findById(id) {
    const queryText = `
      SELECT pay.*, u.first_name as processed_by_first_name, u.last_name as processed_by_last_name
      FROM payments pay
      LEFT JOIN users u ON pay.processed_by = u.id
      WHERE pay.id = $1
    `;
    const result = await db.query(queryText, [id]);
    return result.rows[0];
  }

  async updatePaymentStatus(id, status, reason) {
    const queryText = `
      UPDATE payments
      SET payment_status = $1, refund_reason = $2
      WHERE id = $3
      RETURNING *
    `;
    const result = await db.query(queryText, [status, reason || null, id]);
    return result.rows[0];
  }

  async hasPaidPayment(patientVisitId) {
    const queryText = `
      SELECT 1 FROM payments
      WHERE patient_visit_id = $1 AND payment_status = 'Paid'
      LIMIT 1
    `;
    const result = await db.query(queryText, [patientVisitId]);
    return result.rows.length > 0;
  }

  async getNextReceiptNumber() {
    const queryText = `
      SELECT COUNT(*) as count
      FROM payments
      WHERE paid_at::date = CURRENT_DATE
    `;
    const result = await db.query(queryText);
    const count = parseInt(result.rows[0].count, 10);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `RCT-${today}-${String(count + 1).padStart(4, '0')}`;
  }
}

module.exports = new PaymentRepository();
