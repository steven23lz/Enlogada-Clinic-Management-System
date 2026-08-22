const db = require('../config/database');
const {
  ISSUED_IN_RANGE, REVERSED_IN_RANGE, ISSUED_IN_DAY_RANGE, MONEY_IN_RANGE, ISSUED_RECEIPT_CLAUSE
} = require('../constants/moneyRange');

class ReportRepository {
  /**
   * Money taken in per day. [1.30.0]
   *
   * `payment_status = 'Paid'` used to sit in this predicate, which meant a past day's bar shrank
   * whenever a receipt from that day was reversed weeks later — the chart rewrote history every
   * time a cashier corrected a mistake. Under the cash book a day's takings are what was taken
   * that day, whatever became of the receipt afterwards, so the bar is fixed once the day ends.
   *
   * `ISSUED_RECEIPT_CLAUSE` is new here and is what keeps 'Pending' checkout sessions out now
   * that the status test is gone: an online checkout inserts a row the moment the patient is
   * redirected, carrying a `paid_at` it got from DEFAULT CURRENT_TIMESTAMP, and that is not money
   * until the signed webhook says so.
   */
  async getRevenueTrend(startDate, endDate) {
    const queryText = `
      SELECT pay.paid_at::date as day, SUM(pay.amount) as total
      FROM payments pay
      WHERE ${ISSUED_RECEIPT_CLAUSE}
        AND ${ISSUED_IN_DAY_RANGE}
      GROUP BY pay.paid_at::date
      ORDER BY pay.paid_at::date
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

  // Same basis as the cashier's cash / e-wallet / bank tiles, which are FILTERed off `issued`
  // and are guaranteed in SQL to reconcile to `collected`. On the old basis this breakdown could
  // not add up to the collected figure shown beside it once anything was reversed. [1.30.0]
  async getPaymentMethodBreakdown(startDate, endDate) {
    const queryText = `
      SELECT pay.payment_method, SUM(pay.amount) as total, COUNT(*) as payment_count
      FROM payments pay
      WHERE ${ISSUED_RECEIPT_CLAUSE}
        AND ${ISSUED_IN_RANGE(true)}
      GROUP BY pay.payment_method
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
    // Staff only, and the report says so on its face — "Check-Ins by Staff".
    //
    // `patient_visits.created_by` is whoever opened the visit, and a client booking online opens
    // their own. So every self-service booking put a PATIENT into a staffing report, listed
    // beside the receptionist and counted as though they had worked a desk. On a report an
    // administrator would use to see who is carrying the front desk, that is not a cosmetic
    // problem: it invents throughput for someone who does not work here.
    //
    // The SQL mirrors isStaffUser in src/constants/roles.js — holds any role that is not
    // 'Client' — because that is this system's one definition of staff and a report must not
    // answer the question differently from the middleware.
    const queryText = `
      SELECT u.id as staff_id, u.first_name, u.last_name, COUNT(*) as visit_count
      FROM patient_visits pv
      JOIN users u ON pv.created_by = u.id
      WHERE pv.created_at >= $1::date AND pv.created_at < ($2::date + 1)
        AND EXISTS (
          SELECT 1
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = u.id AND r.name <> 'Client'
        )
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
         -- Must move with getBillingTotals and never separately: operations-report.spec.js
         -- asserts the sum of this breakdown reconciles to that query's collected figure to
         -- within a peso, and two bases would break it the moment anything is reversed. [1.30.0]
         WHERE ${ISSUED_RECEIPT_CLAUSE}
           AND ${ISSUED_IN_RANGE(true)}
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

  /**
   * Cash-up figures: what was taken, what was given away, what was reversed.
   *
   * Three defects fixed together in [1.30.0], because they are one defect wearing three hats.
   * This is the query behind the "Takings" panel on the report that gets PRINTED, so a figure
   * that moves after the fact is a printout disagreeing with a screen.
   *
   * 1. It was left on `payment_status = 'Paid'` over a `paid_at` range while the cashier's
   *    summary moved to the cash book — so the two disagreed about the same day, and this half
   *    still restated closed days, which is the regression [1.30.0] is named for.
   *
   * 2. `refunds`/`refunded` counted `'Refunded'` only, so a receipt a staff member VOIDED —
   *    status 'Cancelled', a real reversal — was reported by the cashier's summary and by
   *    nothing at all here. Its amount fell out of `collected` too, under-reporting both sides
   *    at once, and BillingTotalsPanel hides the stat entirely when it is zero: a day of nothing
   *    but voids showed no reversal at all.
   *
   * 3. `receipt_number IS NOT NULL` was missing. Harmless only while (2) was also true — the two
   *    mistakes cancelled. Widen the reversal side without it and abandoned gateway checkouts,
   *    money never taken, immediately start reporting as refunds. One change, not two.
   */
  async getBillingTotals(startDate, endDate) {
    const issued = ISSUED_IN_RANGE(true);
    const reversed = REVERSED_IN_RANGE(true);
    const queryText = `
      SELECT
        COUNT(*) FILTER (WHERE ${issued})::int              AS receipts,
        COALESCE(SUM(pay.amount)      FILTER (WHERE ${issued}), 0)::numeric(12,2) AS collected,
        COALESCE(SUM(pay.discount_amount) FILTER (WHERE ${issued}), 0)::numeric(12,2) AS discounts,
        COALESCE(SUM(pay.vat_amount)  FILTER (WHERE ${issued}), 0)::numeric(12,2) AS vat_exempted,
        COUNT(*) FILTER (WHERE ${reversed})::int          AS refunds,
        COALESCE(SUM(pay.amount)      FILTER (WHERE ${reversed}), 0)::numeric(12,2) AS refunded
      FROM payments pay
      WHERE ${ISSUED_RECEIPT_CLAUSE}
        AND ${MONEY_IN_RANGE(true)}
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
