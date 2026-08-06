const hmoRepository = require('../repositories/hmoRepository');

class HmoService {
  async createRequest({ hmoProviderId, approvalCode, visitTestIds }) {
    // 1. Create the HMO request
    const request = await hmoRepository.createRequest({ hmoProviderId, approvalCode });

    // 2. Link each visit_test to the HMO request
    const linkedTests = [];
    for (const visitTestId of visitTestIds) {
      const linked = await hmoRepository.addTestToRequest({
        hmoRequestId: request.id,
        visitTestId
      });
      linkedTests.push(linked);
    }

    return {
      ...request,
      tests: linkedTests
    };
  }

  async approveRequest(id, { approvalCode }) {
    const request = await hmoRepository.findRequestById(id);
    if (!request) {
      const error = new Error('HMO request not found');
      error.statusCode = 404;
      throw error;
    }

    return await hmoRepository.approveRequest(id, { approvalCode });
  }

  async updateRequestStatus(id, status) {
    const request = await hmoRepository.findRequestById(id);
    if (!request) {
      const error = new Error('HMO request not found');
      error.statusCode = 404;
      throw error;
    }

    return await hmoRepository.updateRequestStatus(id, status);
  }

  async getRequestDetails(id) {
    const request = await hmoRepository.findRequestById(id);
    if (!request) {
      const error = new Error('HMO request not found');
      error.statusCode = 404;
      throw error;
    }

    const tests = await hmoRepository.findTestsByRequestId(id);
    return { ...request, tests };
  }

  async updateTestApproval(hmoRequestTestId, approvalStatus) {
    return await hmoRepository.updateTestApprovalStatus(hmoRequestTestId, approvalStatus);
  }

  async getProviders() {
    return await hmoRepository.findAllProviders();
  }
}

module.exports = new HmoService();
