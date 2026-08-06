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

    const itemsQuery = `
      SELECT vt.id as visit_test_id, vt.price_at_time, vt.status,
             t.name as test_name, tc.name as category_name
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
