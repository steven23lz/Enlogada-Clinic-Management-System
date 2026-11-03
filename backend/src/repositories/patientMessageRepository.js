const db = require('../config/database');

/**
 * Who is owed one of the server's own patient emails. [1.148.0] See patientMessageService.
 *
 * A visit FINISHED when the last of its tests came out: each test's FIRST authorised report (an
 * amendment weeks later is not the visit finishing again, as in reportRepository FIRST_RELEASE),
 * or, for an X-ray marked done without a report here, when it was marked. `reports` counts the
 * tests with a released report, since "your results are ready" over a visit with nothing to view
 * would send the patient looking for nothing.
 */
const FINISHED = `
  LEFT JOIN LATERAL (
    SELECT MAX(x.first_out) AS completed_at, COUNT(*) FILTER (WHERE x.has_report)::int AS reports
      FROM (
        SELECT COALESCE(
                 (SELECT MIN(tr.authorised_at) FROM test_results tr
                   WHERE tr.visit_test_id = vt.id AND tr.authorised_at IS NOT NULL),
                 vt.performed_at
               ) AS first_out,
               EXISTS (SELECT 1 FROM test_results tr
                        WHERE tr.visit_test_id = vt.id AND tr.is_current AND tr.authorised_at IS NOT NULL) AS has_report
          FROM visit_tests vt
         WHERE vt.patient_visit_id = pv.id
      ) x
  ) done ON TRUE`;

const VISIT_COLUMNS = `
  pv.id AS visit_id, pv.created_at AS visit_date, done.completed_at, done.reports,
  p.first_name, p.last_name, u.email, u.first_name AS account_first_name, u.last_name AS account_last_name`;

/** The stamp each email claims, and the table it lives on. A whitelist: never a caller's string. */
const STAMPS = Object.freeze({
  resultsReady: { table: 'patient_visits', column: 'results_ready_emailed_at' },
  feedbackInvite: { table: 'patient_visits', column: 'feedback_invited_at' },
  missedBooking: { table: 'appointments', column: 'missed_notice_sent_at' },
});

class PatientMessageRepository {
  /** Finished in the last two days, with a report to view, for a patient with a portal account. */
  async findResultsReadyCandidates() {
    const { rows } = await db.query(
      `SELECT ${VISIT_COLUMNS}
         FROM patient_visits pv
         JOIN patients p ON p.id = pv.patient_id
         JOIN users u ON u.id = p.user_id
         ${FINISHED}
        WHERE pv.status = 'Completed'
          AND pv.results_ready_emailed_at IS NULL
          AND pv.created_at >= CURRENT_DATE - 14
          AND done.reports > 0
          AND done.completed_at >= CURRENT_TIMESTAMP - INTERVAL '2 days'
        ORDER BY done.completed_at`
    );
    return rows;
  }

  /**
   * Finished in the last week, not yet rated, and still inside the portal's 30 days to rate it
   * (feedbackService PORTAL_WINDOW_DAYS, counted from the visit's day).
   */
  async findFeedbackCandidates(windowDays) {
    const { rows } = await db.query(
      `SELECT ${VISIT_COLUMNS}, (pv.feedback_submitted_at IS NOT NULL) AS answered
         FROM patient_visits pv
         JOIN patients p ON p.id = pv.patient_id
         JOIN users u ON u.id = p.user_id
         ${FINISHED}
        WHERE pv.status = 'Completed'
          AND pv.feedback_invited_at IS NULL
          AND pv.feedback_submitted_at IS NULL
          AND pv.created_at >= CURRENT_DATE - ($1::int - 1)
          AND done.completed_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
        ORDER BY done.completed_at`,
      [windowDays]
    );
    return rows;
  }

  /**
   * PAID bookings whose day passed with nobody checked in (visitRepository.findMissedPaidBookings,
   * the Desk's list), in the last four days. To the account's address, else the record's: a booking
   * made at the desk for a walk-in has only the record's.
   */
  async findMissedBookingCandidates() {
    const { rows } = await db.query(
      `SELECT a.id, a.appointment_reference, a.scheduled_date, a.scheduled_time,
              p.first_name, p.last_name, COALESCE(u.email, p.email) AS email,
              (p.user_id IS NOT NULL) AS has_account
         FROM appointments a
         JOIN patient_visits pv ON pv.id = a.patient_visit_id
         JOIN patients p ON p.id = pv.patient_id
         LEFT JOIN users u ON u.id = p.user_id
        WHERE a.status = 'Pending'
          AND a.missed_notice_sent_at IS NULL
          AND a.scheduled_date < CURRENT_DATE
          AND a.scheduled_date >= CURRENT_DATE - 4
          AND EXISTS (SELECT 1 FROM payments pay
                       WHERE pay.patient_visit_id = a.patient_visit_id AND pay.payment_status = 'Paid')
        ORDER BY a.scheduled_date, a.scheduled_time`
    );
    return rows;
  }

  /** Takes an email for sending: true for exactly one caller. The stamp means "handled". */
  async claim(kind, id) {
    const { table, column } = STAMPS[kind];
    const { rowCount } = await db.query(
      `UPDATE ${table} SET ${column} = CURRENT_TIMESTAMP WHERE id = $1 AND ${column} IS NULL`,
      [id]
    );
    return rowCount === 1;
  }

  /** A send that failed gives its claim back, to be tried again. */
  async release(kind, id) {
    const { table, column } = STAMPS[kind];
    await db.query(`UPDATE ${table} SET ${column} = NULL WHERE id = $1`, [id]);
  }
}

module.exports = new PatientMessageRepository();
