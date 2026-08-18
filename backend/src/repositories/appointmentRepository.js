const crypto = require('crypto');
const db = require('../config/database');

class AppointmentRepository {
  async createAppointment({ patientVisitId, scheduledDate, scheduledTime, notes }, client = db) {
    // Generate a unique appointment reference for QR code lookup
    const appointmentReference = 'APT-' + crypto.randomBytes(6).toString('hex').toUpperCase();

    const queryText = `
      INSERT INTO appointments (patient_visit_id, appointment_reference, scheduled_date, scheduled_time, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await client.query(queryText, [patientVisitId, appointmentReference, scheduledDate, scheduledTime, notes]);
    return result.rows[0];
  }

  // `is_paid` rides along so the receptionist's QR-scan panel can show, before they check the
  // patient in, whether the online payment actually landed — check-in only releases the ticket
  // to the modality if it did.
  async findByReference(reference) {
    // UI/UX Modernization Phase 10: categories aggregates the visit's already-attached tests'
    // departments (Laboratory/Ultrasound/Xray/...), so Reception can tell the patient exactly
    // where to go right after check-in instead of just clearing the screen with no next step.
    // Empty for a walk-in visit checked in before any tests are attached — that path shows no
    // guidance message, per ReceptionistDashboard.jsx's own handling.
    const queryText = `
      SELECT a.*, pv.patient_id, pv.visit_type, pv.status as visit_status, pv.queue_number,
             p.first_name, p.last_name, p.contact_number, p.birthdate, p.sex,
             pt.name as patient_type_name,
             EXISTS (
               SELECT 1 FROM payments pay
               WHERE pay.patient_visit_id = pv.id AND pay.payment_status = 'Paid'
             ) AS is_paid,
             COALESCE(ARRAY_AGG(DISTINCT tc.name) FILTER (WHERE tc.name IS NOT NULL), '{}') as categories
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      JOIN patient_types pt ON p.patient_type_id = pt.id
      LEFT JOIN visit_tests vt ON vt.patient_visit_id = pv.id
      LEFT JOIN tests t ON vt.test_id = t.id
      LEFT JOIN test_categories tc ON t.category_id = tc.id
      WHERE a.appointment_reference = $1
      GROUP BY a.id, pv.id, pv.patient_id, pv.visit_type, pv.status, pv.queue_number, p.first_name, p.last_name, p.contact_number, p.birthdate, p.sex, pt.name
    `;
    const result = await db.query(queryText, [reference]);
    return result.rows[0];
  }

  // Backs the duplicate guard in appointmentService. Keyed on the patient rather than the user
  // account, because one account owns several profiles and booking two dependents into the same
  // slot is legitimate. appointments has no patient_id of its own, so it reaches one through the
  // visit -- which is also why this rule cannot be a UNIQUE constraint.
  async findActiveByPatientAndSlot({ patientId, scheduledDate, scheduledTime }, client = db) {
    const queryText = `
      SELECT a.*, pv.queue_number
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      WHERE pv.patient_id = $1
        AND a.scheduled_date = $2
        AND a.scheduled_time = $3
        AND a.status <> 'Cancelled'
      LIMIT 1
    `;
    const result = await client.query(queryText, [patientId, scheduledDate, scheduledTime]);
    return result.rows[0];
  }

  async findById(id) {
    const queryText = `
      SELECT a.*, pv.patient_id, pv.visit_type, pv.status as visit_status,
             p.first_name, p.last_name
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE a.id = $1
    `;
    const result = await db.query(queryText, [id]);
    return result.rows[0];
  }

  // `is_paid` drives the client's booking pass: the QR code the receptionist scans is only
  // issued once the online payment has actually settled, so an unpaid booking shows payment
  // options instead of a scannable pass.
  async findByPatientUserId(userId) {
    const queryText = `
      SELECT a.*, pv.patient_id, pv.visit_type, pv.status as visit_status, pv.queue_number,
             p.first_name, p.last_name,
             EXISTS (
               SELECT 1 FROM payments pay
               WHERE pay.patient_visit_id = pv.id AND pay.payment_status = 'Paid'
             ) AS is_paid,
             -- What the patient has to do before this appointment. [1.24.0] put these in the
             -- booking wizard and the confirmation email, and then the patient's own list of
             -- bookings — the screen they open the day before to check the time — could not show
             -- them. A correlated subquery rather than a join, so one row per booking survives
             -- however many tests it carries.
             (
               SELECT COALESCE(
                 ARRAY_AGG(t.preparation ORDER BY t.name) FILTER (WHERE t.preparation IS NOT NULL),
                 '{}'
               )
               FROM visit_tests vt
               JOIN tests t ON vt.test_id = t.id
               WHERE vt.patient_visit_id = pv.id
             ) AS preparation_notes
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE p.user_id = $1
      ORDER BY a.scheduled_date DESC, a.scheduled_time DESC
    `;
    const result = await db.query(queryText, [userId]);
    return result.rows;
  }

  // Paged at the database. [1.29.0] Same shape as visits/history and payments/transactions:
  // this returned every appointment ever booked and the screen showed fifteen. `limit` is
  // optional so any caller that genuinely wants the whole set is unaffected.
  async findAll({ status, dateFrom, dateTo, limit = null, offset = 0 } = {}) {
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`a.status = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`a.scheduled_date >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`a.scheduled_date <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Shared by the list and the count, so the two can never disagree about which rows they mean.
    const fromClause = `
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      ${whereClause}
    `;

    const countRes = await db.query(`SELECT COUNT(*)::int AS total ${fromClause}`, params);
    const total = countRes.rows[0].total;

    let queryText = `
      SELECT a.*, pv.patient_id, pv.visit_type, pv.status as visit_status, pv.queue_number,
             p.first_name, p.last_name
      ${fromClause}
      ORDER BY a.scheduled_date DESC, a.scheduled_time DESC
    `;
    const listParams = [...params];
    if (limit != null) {
      listParams.push(limit);
      queryText += ` LIMIT $${listParams.length}`;
      listParams.push(offset);
      queryText += ` OFFSET $${listParams.length}`;
    }
    const result = await db.query(queryText, listParams);
    return Object.assign(result.rows, { total });
  }

  async updateAppointmentStatus(id, status) {
    const queryText = `
      UPDATE appointments
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const result = await db.query(queryText, [status, id]);
    return result.rows[0];
  }

  /**
   * Everything an appointment email needs, in one read. [1.24.0]
   *
   * The patient's address, their name, and the tests with their preparation instructions —
   * because the instruction is the part of the email that stops a wasted trip, and it is per
   * test rather than per booking.
   *
   * `u.email` is LEFT JOINed: a walk-in registered at the desk has no user account, so this
   * returns a row with a null email rather than no row at all. The caller treats that as "no
   * email to send", which is different from "this booking does not exist".
   */
  async findEmailContextById(appointmentId) {
    const queryText = `
      SELECT a.appointment_reference, a.scheduled_date, a.scheduled_time,
             pv.queue_number,
             p.first_name, p.last_name,
             u.email,
             COALESCE(
               ARRAY_AGG(
                 JSON_BUILD_OBJECT('test_name', t.name, 'preparation', t.preparation)
                 ORDER BY t.name
               ) FILTER (WHERE t.id IS NOT NULL),
               '{}'
             ) AS tests
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN visit_tests vt ON vt.patient_visit_id = pv.id
      LEFT JOIN tests t ON vt.test_id = t.id
      WHERE a.id = $1
      GROUP BY a.id, pv.queue_number, p.first_name, p.last_name, u.email
    `;
    const result = await db.query(queryText, [appointmentId]);
    return result.rows[0];
  }

  // Moves a booking to a different slot.
  //
  // appointment_reference is deliberately NOT reissued. The patient is holding that code — on a
  // screenshot, in an email, as the QR on their booking pass — and a reschedule is the same
  // booking on a different day, not a new one. Reissuing would silently invalidate the pass they
  // will present at the desk.
  //
  // The old slot is released by this same UPDATE: capacity is counted from these two columns, so
  // there is no second write that could fail and leave the booking occupying two slots.
  async updateSchedule(id, { scheduledDate, scheduledTime }) {
    const queryText = `
      UPDATE appointments
      SET scheduled_date = $1, scheduled_time = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;
    const result = await db.query(queryText, [scheduledDate, scheduledTime, id]);
    return result.rows[0];
  }

  // How full a slot is, ignoring one appointment.
  //
  // The exclusion is what makes a reschedule work at the seeded capacity of 1. Without it a
  // booking moved from 09:00 to 09:00 — which the UI allows, because the patient may be changing
  // only the date — counts itself and is refused as full, and the patient is told their own
  // booking is in the way.
  async countActiveInSlot({ scheduledDate, scheduledTime, excludeId = null }) {
    const queryText = `
      SELECT COUNT(*)::int AS cnt
      FROM appointments
      WHERE scheduled_date = $1
        AND scheduled_time = $2
        AND status <> 'Cancelled'
        AND ($3::int IS NULL OR id <> $3)
    `;
    const result = await db.query(queryText, [scheduledDate, scheduledTime, excludeId]);
    return result.rows[0].cnt;
  }
}

module.exports = new AppointmentRepository();
