const hmoRepository = require('../repositories/hmoRepository');
const auditService = require('./auditService');

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

  async getAllRequests(filters) {
    return await hmoRepository.findAllRequests(filters);
  }

  async getProviders() {
    return await hmoRepository.findAllProviders();
  }

  async createProvider(name, requestingUser) {
    if (!name || !name.trim()) {
      const error = new Error('Provider name is required.');
      error.statusCode = 400;
      throw error;
    }

    try {
      const provider = await hmoRepository.createProvider(name.trim());
      await auditService.log({
        actorId: requestingUser?.userId,
        action: 'hmo_provider.created',
        entityType: 'hmo_provider',
        entityId: provider.id,
        description: `Added HMO provider "${provider.name}"`
      });
      return provider;
    } catch (err) {
      if (err.code === '23505') {
        const error = new Error(`An HMO provider named "${name.trim()}" already exists.`);
        error.statusCode = 409;
        throw error;
      }
      throw err;
    }
  }

  async updateProvider(id, { name, isActive }, requestingUser) {
    const provider = await hmoRepository.findProviderById(id);
    if (!provider) {
      const error = new Error('HMO provider not found');
      error.statusCode = 404;
      throw error;
    }

    try {
      const updated = await hmoRepository.updateProvider(id, {
        name: name ? name.trim() : undefined,
        isActive: typeof isActive === 'boolean' ? isActive : undefined
      });

      const changeDescription = typeof isActive === 'boolean' && isActive !== provider.is_active
        ? `${isActive ? 'Activated' : 'Deactivated'} HMO provider "${provider.name}"`
        : `Renamed HMO provider "${provider.name}" to "${updated.name}"`;
      await auditService.log({
        actorId: requestingUser?.userId,
        action: 'hmo_provider.updated',
        entityType: 'hmo_provider',
        entityId: id,
        description: changeDescription
      });

      return updated;
    } catch (err) {
      if (err.code === '23505') {
        const error = new Error(`An HMO provider named "${name.trim()}" already exists.`);
        error.statusCode = 409;
        throw error;
      }
      throw err;
    }
  }
}

module.exports = new HmoService();
