const db = require('../config/database');

/**
 * The discount catalogue, and the entitlement claimed against a particular visit.
 *
 * See migrateDiscounts.js [1.14.0] for why the entitlement lives on patient_visits while the
 * amount actually deducted is snapshotted onto payments.
 */
class DiscountRepository {
  async findAll({ includeInactive = false } = {}) {
    const queryText = `
      SELECT id, name, percentage, is_statutory, requires_id, is_active
      FROM discount_types
      ${includeInactive ? '' : 'WHERE is_active = TRUE'}
      ORDER BY is_statutory DESC, name
    `;
    const result = await db.query(queryText);
    return result.rows;
  }

  async findById(id) {
    const result = await db.query(
      `SELECT id, name, percentage, is_statutory, requires_id, is_active
       FROM discount_types WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  }

  /**
   * Records who granted the discount and when, alongside the entitlement itself.
   *
   * A statutory discount is a claim against the clinic's tax position, not just a price change:
   * BIR expects the holder's ID and the establishment to be able to show who applied it. Storing
   * only the percentage would leave a bill that is cheaper for no recorded reason.
   */
  async applyToVisit(visitId, { discountTypeId, idNumber, grantedBy }) {
    const result = await db.query(
      `UPDATE patient_visits
       SET discount_type_id = $2,
           discount_id_number = $3,
           discount_granted_by = $4,
           discount_granted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, discount_type_id, discount_id_number, discount_granted_at`,
      [visitId, discountTypeId, idNumber || null, grantedBy]
    );
    return result.rows[0];
  }

  async clearFromVisit(visitId) {
    const result = await db.query(
      `UPDATE patient_visits
       SET discount_type_id = NULL,
           discount_id_number = NULL,
           discount_granted_by = NULL,
           discount_granted_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id`,
      [visitId]
    );
    return result.rows[0];
  }

  /**
   * The statutory discount register — the separate record BIR requires an establishment to keep
   * for every mandated discount it grants.
   *
   * Reads from payments rather than patient_visits on purpose: the register must reflect what was
   * actually deducted from money that actually changed hands, not what a visit was once marked
   * eligible for. Refunded rows are included and labelled, because a reversal is part of the
   * record rather than an erasure of it.
   */
  async findStatutoryRegister({ startDate, endDate }) {
    const queryText = `
      SELECT pay.id AS payment_id,
             pay.receipt_number,
             pay.paid_at,
             pay.payment_status,
             pay.discount_type_name,
             pay.discount_id_number,
             pay.discount_amount,
             pay.amount AS amount_paid,
             (pay.amount + pay.discount_amount) AS gross_amount,
             p.first_name, p.last_name
      FROM payments pay
      JOIN patient_visits pv ON pay.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE pay.discount_type_name IS NOT NULL
        AND pay.paid_at >= $1::date
        AND pay.paid_at < ($2::date + 1)
      ORDER BY pay.paid_at DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }
}

module.exports = new DiscountRepository();
