const db = require('../config/database');
const { inTodaysQueue } = require('../constants/queueMembership');

class QueueCallRepository {
  async create({ visitId, station, calledBy }) {
    const { rows } = await db.query(
      `INSERT INTO queue_calls (patient_visit_id, station, called_by)
       VALUES ($1, $2, $3)
       RETURNING id, patient_visit_id, station, called_at`,
      [visitId, station, calledBy]
    );
    return rows[0];
  }

  /**
   * What a call to `station` has to know about the visit. The department's own rule is the
   * worklist's (resultRepository.findPendingByCategory): released to it, with a test still to do.
   */
  async findVisitForCall(visitId, station) {
    const { rows } = await db.query(
      `SELECT pv.id, pv.queue_number, pv.status,
              (pv.created_at >= CURRENT_DATE AND pv.created_at < (CURRENT_DATE + 1)) AS from_today,
              (${inTodaysQueue('pv')}) AS in_queue,
              EXISTS (SELECT 1 FROM payments pay
                       WHERE pay.patient_visit_id = pv.id AND pay.payment_status = 'Paid') AS is_paid,
              (pv.status = 'Processing' AND EXISTS (
                 SELECT 1 FROM visit_tests vt
                   JOIN tests t ON t.id = vt.test_id
                   JOIN test_categories tc ON tc.id = t.category_id
                  WHERE vt.patient_visit_id = pv.id AND tc.name = $2
                    AND vt.status IN ('Processing', 'Waiting for Release')
              )) AS has_work
         FROM patient_visits pv
        WHERE pv.id = $1`,
      [visitId, station]
    );
    return rows[0] || null;
  }

  /**
   * Today's calls, newest first, with the ticket and nothing else about the patient: this feeds a
   * PUBLIC screen, so the privacy control is this SELECT. A half-open range on the raw column.
   */
  async findTodays(limit = 60) {
    const { rows } = await db.query(
      `SELECT qc.id, qc.station, pv.queue_number AS ticket, qc.called_at
         FROM queue_calls qc
         JOIN patient_visits pv ON pv.id = qc.patient_visit_id
        WHERE qc.called_at >= CURRENT_DATE AND qc.called_at < (CURRENT_DATE + 1)
        ORDER BY qc.called_at DESC, qc.id DESC
        LIMIT $1`,
      [limit]
    );
    return rows;
  }

  /** Retention: a call is only of use on its own day, and a little after for a question about it. */
  async pruneOlderThan(days) {
    const { rowCount } = await db.query(
      `DELETE FROM queue_calls WHERE called_at < NOW() - ($1 || ' days')::interval`,
      [String(days)]
    );
    return rowCount;
  }
}

module.exports = new QueueCallRepository();
