const patientRepository = require('../repositories/patientRepository');

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

  async getPatientById(id) {
    const patient = await patientRepository.findPatientById(id);
    if (!patient) {
      const error = new Error('Patient profile not found');
      error.statusCode = 404;
      throw error;
    }
    return patient;
  }

  async updatePatientProfile(id, patientData) {
    const existing = await patientRepository.findPatientById(id);
    if (!existing) {
      const error = new Error('Patient profile not found');
      error.statusCode = 404;
      throw error;
    }
    return await patientRepository.updatePatient(id, patientData);
  }

  async getPatientTypes() {
    return await patientRepository.findPatientTypes();
  }
}

module.exports = new PatientService();
