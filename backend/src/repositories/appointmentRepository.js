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
             ) AS is_paid
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE p.user_id = $1
      ORDER BY a.scheduled_date DESC, a.scheduled_time DESC
    `;
    const result = await db.query(queryText, [userId]);
    return result.rows;
  }

  async findAll({ status, dateFrom, dateTo } = {}) {
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

    const queryText = `
      SELECT a.*, pv.patient_id, pv.visit_type, pv.status as visit_status, pv.queue_number,
             p.first_name, p.last_name
      FROM appointments a
      JOIN patient_visits pv ON a.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      ${whereClause}
      ORDER BY a.scheduled_date DESC, a.scheduled_time DESC
    `;
    const result = await db.query(queryText, params);
    return result.rows;
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
}

module.exports = new AppointmentRepository();
