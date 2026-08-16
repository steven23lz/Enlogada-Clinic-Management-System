const patientRepository = require('../repositories/patientRepository');

/**
 * Which departments confine this caller's view of the roster, or `null` for no confinement.
 * [1.21.0]
 *
 * Expressed as a permission rather than a role check, because the clinic needs to be able to say
 * "this one lab tech also covers reception on Saturdays" without inventing a role — and because a
 * hardcoded `roles.includes('Admin')` exemption is exactly the kind of rule that made the
 * permission matrix advisory in the first place.
 *
 * A Client is not confined here at all: their view is bounded by patient *ownership*, checked in
 * patientController before this is ever consulted, and they are entitled to all of their own
 * records regardless of which room produced them.
 */
function departmentScopeFor(requestingUser) {
  const roles = requestingUser?.roles || [];
  if (roles.includes('Client')) return null;
  if ((requestingUser?.permissions || []).includes('patients:read_all_departments')) return null;
  // `departments` is null for SuperAdmin/Admin, so this is null for them too.
  return requestingUser?.departments ?? null;
}

class PatientService {
  async addPatientProfile(userId, patientData) {
    return await patientRepository.createPatient({
      userId,
      ...patientData
    });
  }

  async getClientPatients(userId) {
    return await patientRepository.findPatientsByUserId(userId);
  }

  /**
   * `requestingUser` is optional so the internal callers that already know what they are doing
   * (the visit flow, the booking wizard) are unaffected. Passed from the controller for the two
   * routes a human hits, which are the ones that need confining.
   */
  async getPatientById(id, requestingUser) {
    const patient = await patientRepository.findPatientById(id);
    if (!patient) {
      const error = new Error('Patient profile not found');
      error.statusCode = 404;
      throw error;
    }

    const scope = requestingUser ? departmentScopeFor(requestingUser) : null;
    if (scope) {
      const covered = await patientRepository.patientHasWorkInDepartments(patient.id, scope);
      if (!covered) {
        // 404, not 403. A 403 confirms the record exists, which is itself a disclosure — "does
        // this clinic have a patient called X" is the question the scoping is there to refuse.
        // Same reasoning the search uses by simply not returning the row.
        const error = new Error('Patient profile not found');
        error.statusCode = 404;
        throw error;
      }
    }

    return patient;
  }

  /**
   * The department scope applies to writes as well as reads, and this is the more important of
   * the two: birthdate and sex are the fields diagnostic reference ranges key off, so editing
   * another department's patient is a clinical-safety question, not only a privacy one.
   *
   * Reusing getPatientById means the read guard and the write guard cannot drift apart — a second
   * copy of the same check is a second thing to forget when the rule changes.
   */
  async updatePatientProfile(id, patientData, requestingUser) {
    await this.getPatientById(id, requestingUser);
    return await patientRepository.updatePatient(id, patientData);
  }

  async searchPatients(query, requestingUser) {
    const trimmed = (query || '').trim();
    if (trimmed.length < 2) {
      const error = new Error('Search query must be at least 2 characters.');
      error.statusCode = 400;
      throw error;
    }
    return await patientRepository.searchPatients(trimmed, departmentScopeFor(requestingUser));
  }

  /** What the caller is allowed to see, so the UI can say so rather than looking broken. */
  departmentScopeFor(requestingUser) {
    return departmentScopeFor(requestingUser);
  }

  async getPatientTypes() {
    return await patientRepository.findPatientTypes();
  }
}

module.exports = new PatientService();
