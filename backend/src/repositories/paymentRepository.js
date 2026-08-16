const db = require('../config/database');

class PaymentRepository {
  /**
   * The discount fields are a snapshot, not a reference.
   *
   * A receipt is a historical record: it must keep saying what it said even if the discount
   * catalogue is renamed, re-rated or deactivated afterwards. Same reasoning as
   * visit_tests.price_at_time. It is also what the statutory register reads, so the register
   * reflects what was actually deducted from money that actually changed hands.
   */
  async createPayment({
    patientVisitId, processedBy, paymentMethod, referenceNumber, receiptNumber, amount,
    discountAmount = 0, discountTypeName = null, discountIdNumber = null, vatAmount = 0
  }) {
    const queryText = `
      INSERT INTO payments (
        patient_visit_id, processed_by, payment_method, reference_number, receipt_number, amount,
        discount_amount, discount_type_name, discount_id_number, vat_amount
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    const result = await db.query(queryText, [
      patientVisitId, processedBy, paymentMethod, referenceNumber, receiptNumber, amount,
      discountAmount, discountTypeName, discountIdNumber, vatAmount
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

    // Only settled money. Online GCash/Maya checkouts insert a 'Pending' row the moment the
    // patient is redirected to the provider, and that row must never reach the cashier's
    // transaction log or daily collections total — it isn't revenue until the signed webhook
    // confirms it. Every pre-gateway row is 'Paid', so this narrows nothing that existed before.
    if (startDate && endDate) {
      // Half-open range rather than a ::date cast: a B-tree index cannot serve a predicate on
      // an expression, so the cast turned every transaction lookup into a sequential scan of
      // payments — the table that grows fastest and is read on every cashier dashboard load.
      queryText += " WHERE pay.payment_status = 'Paid' AND pay.paid_at >= $1::date AND pay.paid_at < ($2::date + 1)";
      params.push(startDate, endDate);
    } else {
      queryText += " WHERE pay.payment_status = 'Paid' AND pay.paid_at >= CURRENT_DATE AND pay.paid_at < (CURRENT_DATE + 1)";
    }

    queryText += ' ORDER BY pay.paid_at DESC';
    const result = await db.query(queryText, params);
    return result.rows;
  }

  async getBillingSummary(patientVisitId) {
    const visitQuery = `
      SELECT pv.id, p.first_name, p.last_name, pt.name as patient_type_name,
             -- Printed on the receipt: the ticket number is what the patient was called by, and
             -- the thing that ties the paper in their hand back to the queue slip.
             pv.queue_number,
             pv.discount_id_number,
             dt.id   as discount_type_id,
             dt.name as discount_name,
             dt.percentage as discount_percentage,
             dt.is_statutory as discount_is_statutory
      FROM patient_visits pv
      JOIN patients p ON pv.patient_id = p.id
      JOIN patient_types pt ON p.patient_type_id = pt.id
      LEFT JOIN discount_types dt ON pv.discount_type_id = dt.id
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

  // --- Online payment gateway (GCash / Maya via PayMongo hosted checkout) -----------------

  // Inserted as 'Pending' when the patient is redirected to the provider. Deliberately NOT
  // 'Paid': the browser coming back to our success_url proves nothing (it is a plain URL the
  // patient can visit directly), so only the signed webhook may settle this row.
  async createPendingGatewayPayment({ patientVisitId, processedBy, paymentMethod, amount, gatewayProvider, gatewaySessionId }) {
    const queryText = `
      INSERT INTO payments (
        patient_visit_id, processed_by, payment_method, amount,
        payment_status, gateway_provider, gateway_session_id
      )
      VALUES ($1, $2, $3, $4, 'Pending', $5, $6)
      RETURNING *
    `;
    const result = await db.query(queryText, [
      patientVisitId, processedBy, paymentMethod, amount, gatewayProvider, gatewaySessionId
    ]);
    return result.rows[0];
  }

  async findByGatewaySessionId(gatewaySessionId) {
    const queryText = `
      SELECT pay.*, p.first_name, p.last_name
      FROM payments pay
      JOIN patient_visits pv ON pay.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE pay.gateway_session_id = $1
    `;
    const result = await db.query(queryText, [gatewaySessionId]);
    return result.rows[0];
  }

  // The webhook settlement. `WHERE payment_status = 'Pending'` makes this idempotent: PayMongo
  // retries webhook deliveries, and a redelivery of an already-settled session must not issue
  // a second receipt number or re-trigger the ticket release. A no-op returns undefined.
  async markGatewayPaymentPaid(gatewaySessionId, { gatewayPaymentId, receiptNumber }) {
    const queryText = `
      UPDATE payments
      SET payment_status = 'Paid',
          gateway_payment_id = $2,
          receipt_number = $3,
          paid_at = CURRENT_TIMESTAMP
      WHERE gateway_session_id = $1 AND payment_status = 'Pending'
      RETURNING *
    `;
    const result = await db.query(queryText, [gatewaySessionId, gatewayPaymentId, receiptNumber]);
    return result.rows[0];
  }

  /**
   * Settles a gateway payment whose row is NOT 'Pending' — the money moved anyway.
   *
   * The normal path is markGatewayPaymentPaid, whose `payment_status = 'Pending'` predicate makes
   * webhook redelivery idempotent. This is the recovery path for the case that predicate cannot
   * distinguish: a session we marked 'Cancelled' (because the patient opened a second checkout)
   * that the patient then went back and completed. PayMongo took the money; refusing to record it
   * does not give it back.
   *
   * Excludes 'Paid' so it can never overwrite a settled row, and the caller must handle a 23505
   * from uq_payments_one_paid_per_visit — that means the visit was *also* paid another way, which
   * is a genuine double charge needing a refund, not a row this method should quietly create.
   */
  async forceSettleGatewayPayment(gatewaySessionId, { gatewayPaymentId, receiptNumber }) {
    const queryText = `
      UPDATE payments
      SET payment_status = 'Paid',
          gateway_payment_id = $2,
          receipt_number = $3,
          paid_at = CURRENT_TIMESTAMP
      WHERE gateway_session_id = $1 AND payment_status <> 'Paid'
      RETURNING *
    `;
    const result = await db.query(queryText, [gatewaySessionId, gatewayPaymentId, receiptNumber]);
    return result.rows[0];
  }

  async cancelPendingGatewayPayments(patientVisitId) {
    const queryText = `
      UPDATE payments
      SET payment_status = 'Cancelled'
      WHERE patient_visit_id = $1
        AND payment_status = 'Pending'
        AND gateway_session_id IS NOT NULL
      RETURNING *
    `;
    const result = await db.query(queryText, [patientVisitId]);
    return result.rows;
  }

  async findPendingGatewayPaymentForVisit(patientVisitId) {
    const queryText = `
      SELECT * FROM payments
      WHERE patient_visit_id = $1
        AND payment_status = 'Pending'
        AND gateway_session_id IS NOT NULL
      ORDER BY paid_at DESC
      LIMIT 1
    `;
    const result = await db.query(queryText, [patientVisitId]);
    return result.rows[0];
  }

  /**
   * Issues the next receipt number for today, atomically.
   *
   * This was `SELECT COUNT(*) … WHERE payment_status = 'Paid' AND paid_at::date = CURRENT_DATE`
   * followed by a separate INSERT of count+1, which produced duplicate official receipt numbers
   * two different ways:
   *
   *   - Concurrently: two cashiers settling in the same moment both read 5 and both mint
   *     RCT-YYYYMMDD-0006. Two patients leave holding the same receipt number, and the drawer can
   *     no longer be reconciled against the system.
   *   - With no concurrency at all: refunding a payment drops it out of the 'Paid' count, so the
   *     very next sale that day reuses a receipt number that has already been printed and handed
   *     to a patient.
   *
   * The counter fixes both. It counts issuances rather than surviving rows, so a refund cannot
   * rewind it, and ON CONFLICT DO UPDATE takes a row lock so concurrent callers serialise. A
   * unique index on receipt_number backs it at the schema level — see migrateDataIntegrity.js.
   */
  async getNextReceiptNumber() {
    // Both halves of the receipt number come from the same row, in one statement.
    //
    // The date used to be formatted in JavaScript as `new Date().toISOString()`, which is UTC,
    // while the counter came from Postgres CURRENT_DATE, which is the server's local date. In
    // Philippine time (UTC+8) those disagree for the first eight hours of every day: a payment
    // taken at 01:00 on the 15th was stamped RCT-20260814-…, dated to the previous day, while its
    // sequence number came from the 15th's counter. Receipts issued in that window sort and
    // reconcile against the wrong day, and the same stamp reappears the following morning —
    // exactly the collision the unique index now rejects, turning a silent mis-dating into a
    // failed payment.
    //
    // Deriving both from counter_date makes disagreement impossible by construction.
    const queryText = `
      INSERT INTO daily_counters (counter_date, counter_name, last_number)
      VALUES (CURRENT_DATE, 'receipt', 1)
      ON CONFLICT (counter_date, counter_name)
      DO UPDATE SET last_number = daily_counters.last_number + 1
      RETURNING last_number, to_char(counter_date, 'YYYYMMDD') AS date_key
    `;
    const result = await db.query(queryText);
    const { last_number, date_key } = result.rows[0];
    return `RCT-${date_key}-${String(last_number).padStart(4, '0')}`;
  }
}

module.exports = new PaymentRepository();
