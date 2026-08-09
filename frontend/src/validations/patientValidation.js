// Mirrors backend/src/controllers/patientController.js's authoritative required-field list
// (patientTypeId, firstName, lastName, birthdate, sex), which itself mirrors the NOT NULL
// columns on the `patients` table in database/schema.sql.
export function validatePatientProfile({ patientTypeId, firstName, lastName, birthdate, sex }) {
  if (
    !patientTypeId ||
    !String(firstName ?? '').trim() ||
    !String(lastName ?? '').trim() ||
    !birthdate ||
    !sex
  ) {
    return 'Patient type, first name, last name, birthdate, and sex are required.';
  }
  return null;
}
