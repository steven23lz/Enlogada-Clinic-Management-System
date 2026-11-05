const db = require('../config/database');
const { hmoEffectiveStatus } = require('../constants/hmoEffectiveStatus');

/** The refund's own tables, and the writes a refund makes to the visit it belongs to. [1.155.0] */
class PaymentRefundRepository {
  /** The receipt, locked for the length of the transaction, so two refunds cannot both pass the checks. */
  async lockPayment(id) {
    const { rows } = await db.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [id]);
    return rows[0];
  }

  /** The receipt, with whose it is and who may hear about it. */
  async findPaymentWithPatient(id) {
    const { rows } = await db.query(
      `SELECT pay.*, p.first_name, p.last_name, COALESCE(u.email, p.email) AS patient_email,
              a.id AS appointment_id
         FROM payments pay
         JOIN patient_visits pv ON pv.id = pay.patient_visit_id
         JOIN patients p ON p.id = pv.patient_id
         LEFT JOIN users u ON u.id = p.user_id
         LEFT JOIN appointments a ON a.patient_visit_id = pv.id
        WHERE pay.id = $1`,
      [id]
    );
    return rows[0];
  }

  /** Every test on the visit, with what decides whether it can be refunded. */
  async findVisitTests(visitId) {
    const { rows } = await db.query(
      `SELECT vt.id, vt.status, vt.price_at_time AS price, vt.performed_at IS NOT NULL AS performed, t.name,
              EXISTS (SELECT 1 FROM test_results tr WHERE tr.visit_test_id = vt.id AND tr.authorised_at IS NOT NULL) AS authorised,
              EXISTS (SELECT 1 FROM payment_refund_tests rt WHERE rt.visit_test_id = vt.id) AS refunded,
              COALESCE((
                SELECT ${hmoEffectiveStatus('hr', 'hrt')}
                  FROM hmo_request_tests hrt
                  JOIN hmo_requests hr ON hr.id = hrt.hmo_request_id
                 WHERE hrt.visit_test_id = vt.id
                 ORDER BY hrt.created_at DESC
                 LIMIT 1
              ), '') = 'Approved' AS "hmoApproved"
         FROM visit_tests vt
         JOIN tests t ON t.id = vt.test_id
        WHERE vt.patient_visit_id = $1
        ORDER BY vt.id`,
      [visitId]
    );
    return rows;
  }

  async totalRefunded(paymentId) {
    const { rows } = await db.query(
      'SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS total FROM payment_refunds WHERE payment_id = $1',
      [paymentId]
    );
    return Number(rows[0].total);
  }

  async create({ paymentId, amount, kind, reason, returnedVia, returnedReference, refundedBy, tests }) {
    const { rows } = await db.query(
      `INSERT INTO payment_refunds (payment_id, amount, kind, reason, returned_via, returned_reference, refunded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [paymentId, amount, kind, reason, returnedVia, returnedReference, refundedBy]
    );
    for (const t of tests) {
      await db.query(
        'INSERT INTO payment_refund_tests (refund_id, visit_test_id, amount) VALUES ($1, $2, $3)',
        [rows[0].id, t.id, t.amount]
      );
    }
    return rows[0];
  }

  /**
   * What the receipt says afterwards. `refunded_at` is the latest refund, for the receipt log's own
   * row; the money reads `payment_refunds`. `fullyBack` makes it stop being paid: the unique index that
   * allows one paid receipt per visit is partial on 'Paid', so the right payment can then be taken.
   */
  async markRefunded(paymentId, { reason, fullyBack }) {
    await db.query(
      `UPDATE payments
          SET refunded_at = CURRENT_TIMESTAMP, refund_reason = $2,
              payment_status = CASE WHEN $3::boolean THEN 'Refunded' ELSE payment_status END
        WHERE id = $1`,
      [paymentId, reason, fullyBack]
    );
  }

  async cancelTests(ids) {
    await db.query(
      `UPDATE visit_tests SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::int[])`,
      [ids]
    );
  }

  /** A payment recorded by mistake: the visit owes again, and its tests wait for the right payment. */
  async returnVisitToUnpaid(visitId) {
    await db.query(
      `UPDATE visit_tests SET status = 'Pending', updated_at = CURRENT_TIMESTAMP
        WHERE patient_visit_id = $1 AND status = 'Processing'`,
      [visitId]
    );
    await db.query(
      `UPDATE patient_visits SET status = 'Pending', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [visitId]
    );
  }

  /** Nothing is left to do on a booking: its slot goes back on offer. */
  async cancelAppointmentOfVisit(visitId) {
    await db.query(
      `UPDATE appointments SET status = 'Cancelled', held_until = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE patient_visit_id = $1 AND status IN ('Pending', 'Confirmed')`,
      [visitId]
    );
  }
}

module.exports = new PaymentRefundRepository();
