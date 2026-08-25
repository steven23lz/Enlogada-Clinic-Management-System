const db = require('../config/database');

/**
 * All SQL for manual proof-of-payment claims. See migrations.md [1.48.0].
 *
 * A submission is EVIDENCE, not money. `payments` remains the only table any peso figure is
 * aggregated from — see the migration's header for why this is deliberately not a payment row
 * with an 'Unverified' status.
 */
class PaymentSubmissionRepository {
  async create({ patientVisitId, paymentMethodId, referenceNumber, amountClaimed, submittedBy, proof }) {
    const result = await db.query(
      `INSERT INTO payment_submissions
         (patient_visit_id, payment_method_id, reference_number, amount_claimed, submitted_by,
          proof_file_path, proof_original_name, proof_mime_type, proof_size_bytes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending')
       RETURNING *`,
      [patientVisitId, paymentMethodId || null, referenceNumber, amountClaimed, submittedBy || null,
        proof?.filePath || null, proof?.originalName || null, proof?.mimeType || null,
        proof?.sizeBytes || null]
    );
    return result.rows[0];
  }

  async findById(id) {
    const result = await db.query('SELECT * FROM payment_submissions WHERE id = $1', [id]);
    return result.rows[0];
  }

  /** The live claim on a visit, if there is one. At most one by uq_paysub_one_live_per_visit. */
  async findPendingForVisit(patientVisitId) {
    const result = await db.query(
      `SELECT * FROM payment_submissions WHERE patient_visit_id = $1 AND status = 'Pending'`,
      [patientVisitId]
    );
    return result.rows[0];
  }

  /** Everything a patient has claimed for one visit, newest first, so they can see a rejection. */
  async findAllForVisit(patientVisitId) {
    const result = await db.query(
      `SELECT ps.*, pm.label AS method_label, pm.kind AS method_kind
         FROM payment_submissions ps
         LEFT JOIN payment_methods pm ON pm.id = ps.payment_method_id
        WHERE ps.patient_visit_id = $1
        ORDER BY ps.submitted_at DESC`,
      [patientVisitId]
    );
    return result.rows;
  }

  /**
   * The cashier's review queue — everything awaiting a decision, oldest first.
   *
   * Oldest first because it is a queue: the patient who has been waiting longest for their booking
   * pass is the one to deal with next. Carries enough patient and visit context that the cashier
   * does not have to open another screen to decide.
   */
  async findPending() {
    const result = await db.query(
      `SELECT ps.id, ps.patient_visit_id, ps.reference_number, ps.amount_claimed,
              ps.submitted_at, ps.status,
              (ps.proof_file_path IS NOT NULL) AS has_proof,
              -- What the visit actually owes, so the cashier can compare it with what the patient
              -- says they sent WITHOUT opening another screen.
              --
              -- This matters more than it looks. Approval bills the visit's real total, not the
              -- claimed figure — so approving a screenshot that says 50 on a 1450 visit records
              -- 1450 as received and the clinic is short 1400 with nothing on screen to say so.
              -- The cashier is the control, and a control needs both numbers side by side.
              (SELECT COALESCE(SUM(vt.price_at_time), 0)
                 FROM visit_tests vt
                WHERE vt.patient_visit_id = pv.id) AS amount_due,
              pm.label AS method_label, pm.kind AS method_kind,
              p.first_name, p.last_name,
              pv.queue_number, pv.visit_type,
              a.appointment_reference, a.scheduled_date, a.scheduled_time
         FROM payment_submissions ps
         JOIN patient_visits pv ON pv.id = ps.patient_visit_id
         JOIN patients p        ON p.id = pv.patient_id
         LEFT JOIN payment_methods pm ON pm.id = ps.payment_method_id
         LEFT JOIN appointments a     ON a.patient_visit_id = pv.id
        WHERE ps.status = 'Pending'
        ORDER BY ps.submitted_at ASC`
    );
    return result.rows;
  }

  /**
   * Settle a claim.
   *
   * `WHERE status = 'Pending'` is the concurrency guard, not decoration: two cashiers opening the
   * queue together would otherwise both approve the same claim, and the second approval would try
   * to take the money twice. The second UPDATE matches nothing and the caller sees no row back.
   */
  async settle(id, { status, reviewedBy, reviewNote, paymentId }) {
    const result = await db.query(
      `UPDATE payment_submissions
          SET status = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP,
              review_note = $4, payment_id = $5
        WHERE id = $1 AND status = 'Pending'
      RETURNING *`,
      [id, status, reviewedBy, reviewNote || null, paymentId || null]
    );
    return result.rows[0];
  }
}

module.exports = new PaymentSubmissionRepository();
