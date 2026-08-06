const visitRepository = require('../repositories/visitRepository');

class VisitService {
  async registerVisit({ patientId, visitType, notes, createdBy }) {
    // Generate daily queue number
    const queueNumber = await visitRepository.getNextQueueNumber();

    const visit = await visitRepository.createVisit({
      patientId,
      visitType,
      notes,
      queueNumber,
      createdBy
    });

    return visit;
  }

  async getActiveVisits() {
    return await visitRepository.findActiveVisits();
  }

  async getVisitById(id) {
    const visit = await visitRepository.findVisitById(id);
    if (!visit) {
      const error = new Error('Visit not found');
      error.statusCode = 404;
      throw error;
    }
    return visit;
  }

  async updateStatus(id, status) {
    const visit = await visitRepository.findVisitById(id);
    if (!visit) {
      const error = new Error('Visit not found');
      error.statusCode = 404;
      throw error;
    }
    return await visitRepository.updateVisitStatus(id, status);
  }

  async getVisitHistory(patientId) {
    return await visitRepository.findVisitsByPatientId(patientId);
  }
}

module.exports = new VisitService();
