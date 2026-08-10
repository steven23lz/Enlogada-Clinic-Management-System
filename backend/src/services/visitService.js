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

  async getActiveVisits({ search, status, page, limit } = {}) {
    const opts = {};
    if (search) opts.search = search;
    if (status) opts.status = status;

    let pageNum, limitNum;
    if (limit != null) {
      limitNum = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 200);
      pageNum = Math.max(parseInt(page, 10) || 1, 1);
      opts.limit = limitNum;
      opts.offset = (pageNum - 1) * limitNum;
    }

    const result = await visitRepository.findActiveVisits(opts);
    if (limitNum) {
      return { ...result, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(result.total / limitNum)) };
    }
    return result;
  }

  async getVisitHistoryByDateRange({ startDate, endDate, search }) {
    const today = new Date().toISOString().slice(0, 10);
    return await visitRepository.findVisitsByDateRange({
      startDate: startDate || today,
      endDate: endDate || today,
      search
    });
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
