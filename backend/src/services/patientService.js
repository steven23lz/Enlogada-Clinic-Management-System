const patientRepository = require('../repositories/patientRepository');
const auditService = require('./auditService');

/**
 * Which columns an edit may touch, and what to call them in the log.
 *
 * birthdate and sex lead deliberately: they are the two that change how a result is read, not just
 * how the patient is contacted.
 */
const AUDITED_FIELDS = [
  ['birthdate', 'Birthdate'],
  ['sex', 'Sex'],
  ['first_name', 'First name'],
  ['last_name', 'Last name'],
  ['patient_type_id', 'Patient type'],
  ['contact_number', 'Contact number'],
  ['address', 'Address'],
  ['emergency_contact', 'Emergency contact'],
];

/** A DATE comes back as a Date object; everything else is a string or null. Compare as text. */
const asText = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value);
};

/** "Birthdate 1990-01-01 → 1990-02-01" for each field that actually moved. */
function describeChanges(before, after) {
  const changes = [];
  for (const [column, label] of AUDITED_FIELDS) {
    const from = asText(before?.[column]);
    const to = asText(after?.[column]);
    if (from !== to) changes.push(`${label} ${from || '(blank)'} → ${to || '(blank)'}`);
  }
  return changes;
}

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
    const before = await this.getPatientById(id, requestingUser);
    const updated = await patientRepository.updatePatient(id, patientData);

    // Audited with a field-level diff, not a bare "patient updated". [1.24.0]
    //
    // Two of these fields are clinical inputs rather than contact details: diagnostic reference
    // ranges are banded by age and by sex, so correcting a birthdate silently re-interprets every
    // result already on that patient's file. "Someone edited this record" does not answer the
    // question that gets asked afterwards, which is always what it said before.
    //
    // Only what actually changed is recorded. Saving a form without touching it is not an event,
    // and logging it anyway is the fan-out mistake that buried notification_reads.
    const changes = describeChanges(before, updated);
    if (changes.length > 0) {
      await auditService.log({
        actorId: requestingUser?.userId,
        action: 'patient.updated',
        entityType: 'patient',
        entityId: Number(id),
        description: `${before.first_name} ${before.last_name} (PT-${id}): ${changes.join('; ')}`,
      });
    }

    return updated;
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
