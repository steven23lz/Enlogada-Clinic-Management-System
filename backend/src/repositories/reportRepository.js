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

  // ── Per-department operational metrics [1.22.0] ────────────────────────────────────────────
  //
  // Every date predicate below is a half-open range on the raw column, never `col::date = …`.
  // A B-tree index cannot serve a predicate on an expression, so the cast form silently forces a
  // sequential scan whatever is indexed — measured at 50.7ms vs 0.84ms on 219k rows. See the
  // dates note in CLAUDE.md.

  /**
   * What the clinic actually sold, by service and by category.
   *
   * Revenue is attributed from `visit_tests.price_at_time` on visits that were PAID, not from
   * the payment total: a payment is one figure for a basket, and "which test earns the money" is
   * the question this answers. price_at_time rather than the live `tests.price` so a later price
   * change does not silently rewrite last month's numbers.
   *
   * The discount is apportioned across the visit's tests rather than ignored, otherwise the sum
   * of this breakdown would exceed the money actually taken — a report that does not reconcile
   * with the cash drawer is a report nobody trusts twice.
   */
  async getSalesByService(startDate, endDate) {
    const queryText = `
      WITH paid AS (
        SELECT pay.patient_visit_id,
               SUM(pay.amount)                            AS collected,
               SUM(pay.discount_amount + pay.vat_amount)  AS deducted
          FROM payments pay
         WHERE pay.payment_status = 'Paid'
           AND pay.paid_at >= $1::date AND pay.paid_at < ($2::date + 1)
         GROUP BY pay.patient_visit_id
      ),
      lines AS (
        SELECT vt.patient_visit_id,
               t.name  AS test_name,
               tc.name AS category_name,
               vt.price_at_time,
               -- Each test's share of the visit's gross, used to spread the deduction.
               vt.price_at_time / NULLIF(SUM(vt.price_at_time) OVER (PARTITION BY vt.patient_visit_id), 0) AS share
          FROM visit_tests vt
          JOIN tests t            ON t.id = vt.test_id
          JOIN test_categories tc ON tc.id = t.category_id
         WHERE vt.patient_visit_id IN (SELECT patient_visit_id FROM paid)
      )
      SELECT l.test_name, l.category_name,
             COUNT(*)::int                                              AS sold,
             SUM(l.price_at_time)::numeric(12,2)                        AS gross,
             SUM(l.price_at_time - (p.deducted * l.share))::numeric(12,2) AS net
        FROM lines l
        JOIN paid p ON p.patient_visit_id = l.patient_visit_id
       GROUP BY l.test_name, l.category_name
       ORDER BY net DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  /** Cash-up figures: what was taken, what was given away, what was reversed. */
  async getBillingTotals(startDate, endDate) {
    const queryText = `
      SELECT
        COUNT(*) FILTER (WHERE payment_status = 'Paid')::int              AS receipts,
        COALESCE(SUM(amount)      FILTER (WHERE payment_status = 'Paid'), 0)::numeric(12,2) AS collected,
        COALESCE(SUM(discount_amount) FILTER (WHERE payment_status = 'Paid'), 0)::numeric(12,2) AS discounts,
        COALESCE(SUM(vat_amount)  FILTER (WHERE payment_status = 'Paid'), 0)::numeric(12,2) AS vat_exempted,
        COUNT(*) FILTER (WHERE payment_status = 'Refunded')::int          AS refunds,
        COALESCE(SUM(amount)      FILTER (WHERE payment_status = 'Refunded'), 0)::numeric(12,2) AS refunded
      FROM payments
      WHERE paid_at >= $1::date AND paid_at < ($2::date + 1)
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows[0];
  }

  /**
   * Front-desk throughput, including how long a patient waits to be billed.
   *
   * The wait is measured check-in -> payment because that is the part of the visit the front desk
   * and the till jointly own; everything after it belongs to a department and is measured
   * separately below. PERCENTILE_CONT for the median as well as the mean: one patient who came in
   * at 8am and paid at 5pm drags an average into uselessness, and the median is what actually
   * describes a normal morning.
   */
  async getReceptionThroughput(startDate, endDate) {
    const queryText = `
      SELECT
        COUNT(*)::int                                                    AS visits,
        COUNT(*) FILTER (WHERE pv.visit_type = 'Walk in')::int           AS walk_ins,
        COUNT(*) FILTER (WHERE pv.visit_type <> 'Walk in')::int          AS appointments,
        COUNT(*) FILTER (WHERE pv.status = 'Cancelled')::int             AS cancelled,
        COUNT(*) FILTER (WHERE pv.status = 'Completed')::int             AS completed,
        COALESCE(AVG(EXTRACT(EPOCH FROM (pay.paid_at - pv.created_at)) / 60)
                 FILTER (WHERE pay.paid_at IS NOT NULL), 0)::int         AS avg_wait_minutes,
        COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(EPOCH FROM (pay.paid_at - pv.created_at)) / 60
                 ), 0)::int                                              AS median_wait_minutes
      FROM patient_visits pv
      LEFT JOIN LATERAL (
        SELECT MIN(p2.paid_at) AS paid_at
          FROM payments p2
         WHERE p2.patient_visit_id = pv.id AND p2.payment_status = 'Paid'
      ) pay ON TRUE
      WHERE pv.created_at >= $1::date AND pv.created_at < ($2::date + 1)
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows[0];
  }

  /**
   * Per-department turnaround: payment to released report.
   *
   * Payment is the right start point because that is when the ticket actually reaches the
   * modality — a visit registered at 8am but paid at 11am did not spend three hours in the lab.
   * `is_current` throughout, or an amended report counts twice and its correction time is
   * averaged in as though it were a second patient.
   */
  async getDiagnosticThroughput(startDate, endDate) {
    const queryText = `
      SELECT tc.name AS category_name,
             COUNT(*)::int                                        AS released,
             COUNT(*) FILTER (WHERE tr.is_critical)::int          AS critical,
             COUNT(*) FILTER (WHERE tr.version > 1)::int          AS amended,
             COALESCE(AVG(EXTRACT(EPOCH FROM (tr.released_at - pay.paid_at)) / 60)
                      FILTER (WHERE pay.paid_at IS NOT NULL), 0)::int AS avg_turnaround_minutes,
             COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (
                        ORDER BY EXTRACT(EPOCH FROM (tr.released_at - pay.paid_at)) / 60
                      ), 0)::int                                  AS median_turnaround_minutes
        FROM test_results tr
        JOIN visit_tests vt     ON vt.id = tr.visit_test_id
        JOIN tests t            ON t.id = vt.test_id
        JOIN test_categories tc ON tc.id = t.category_id
        LEFT JOIN LATERAL (
          SELECT MIN(p2.paid_at) AS paid_at
            FROM payments p2
           WHERE p2.patient_visit_id = vt.patient_visit_id AND p2.payment_status = 'Paid'
        ) pay ON TRUE
       WHERE tr.is_current
         AND tr.released_at >= $1::date AND tr.released_at < ($2::date + 1)
       GROUP BY tc.name
       ORDER BY released DESC
    `;
    const result = await db.query(queryText, [startDate, endDate]);
    return result.rows;
  }

  /** Work still outstanding right now — a backlog, not a date range. */
  async getOutstandingWork() {
    const queryText = `
      SELECT tc.name AS category_name,
             COUNT(*) FILTER (WHERE vt.status = 'Processing')::int          AS awaiting_exam,
             COUNT(*) FILTER (WHERE vt.status = 'Waiting for Release')::int AS awaiting_release
        FROM visit_tests vt
        JOIN tests t            ON t.id = vt.test_id
        JOIN test_categories tc ON tc.id = t.category_id
       WHERE vt.status IN ('Processing', 'Waiting for Release')
       GROUP BY tc.name
       ORDER BY tc.name
    `;
    const result = await db.query(queryText);
    return result.rows;
  }
}

module.exports = new ReportRepository();
