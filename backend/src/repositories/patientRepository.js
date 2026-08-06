const db = require('../config/database');

class PatientRepository {
  async createPatient({ userId, patientTypeId, firstName, lastName, birthdate, sex, address, contactNumber, emergencyContact }) {
    const queryText = `
      INSERT INTO patients (user_id, patient_type_id, first_name, last_name, birthdate, sex, address, contact_number, emergency_contact)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    const result = await db.query(queryText, [
      userId || null,
      patientTypeId,
      firstName,
      lastName,
      birthdate,
      sex,
      address,
      contactNumber,
      emergencyContact
    ]);
    return result.rows[0];
  }

  async findPatientsByUserId(userId) {
    const queryText = `
      SELECT p.*, pt.name as patient_type_name
      FROM patients p
      JOIN patient_types pt ON p.patient_type_id = pt.id
      WHERE p.user_id = $1
      ORDER BY p.last_name, p.first_name
    `;
    const result = await db.query(queryText, [userId]);
    return result.rows;
  }

  async findPatientById(id) {
    const queryText = `
      SELECT p.*, pt.name as patient_type_name
      FROM patients p
      JOIN patient_types pt ON p.patient_type_id = pt.id
      WHERE p.id = $1
    `;
    const result = await db.query(queryText, [id]);
    return result.rows[0];
  }

  async updatePatient(id, { patientTypeId, firstName, lastName, birthdate, sex, address, contactNumber, emergencyContact }) {
    const queryText = `
      UPDATE patients
      SET patient_type_id = $1, first_name = $2, last_name = $3, birthdate = $4, sex = $5, address = $6, contact_number = $7, emergency_contact = $8, updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING *
    `;
    const result = await db.query(queryText, [
      patientTypeId,
      firstName,
      lastName,
      birthdate,
      sex,
      address,
      contactNumber,
      emergencyContact,
      id
    ]);
    return result.rows[0];
  }

  async findPatientTypes() {
    const queryText = 'SELECT id, name FROM patient_types ORDER BY id';
    const result = await db.query(queryText);
    return result.rows;
  }
}

module.exports = new PatientRepository();
