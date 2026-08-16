const hmoRepository = require('../repositories/hmoRepository');
const auditService = require('./auditService');

// Mirrors testService.js's assertClientOwnsVisit, which exists for the same reason: that endpoint
// also authorizes the Client role for self-service booking and originally trusted whatever ids the
// caller sent. This endpoint opened to Clients when online booking needed it, and without this a
// client could attach an HMO claim to a stranger's tests — a claim against someone else's bill,
// filed under their own provider and LOA code.
//
// Validation is all-or-nothing and runs before any write. Filtering the caller's ids down to the
// ones they own would silently under-claim: a three-test claim quietly becoming a two-test claim
// bills the patient out of pocket for the third with nothing on screen to explain it.
async function assertClientOwnsVisitTests(requestingUser, visitTestIds) {
  const uniqueIds = [...new Set(visitTestIds)];
  const rows = await hmoRepository.findOwnershipInfoByVisitTestIds(uniqueIds);

  if (rows.length !== uniqueIds.length) {
    const error = new Error('One or more of these tests do not exist.');
    error.statusCode = 404;
    throw error;
  }

  // An HMO request is one approval covering one visit. The schema cannot express that —
  // hmo_requests has no patient_visit_id, reaching a visit only transitively through
  // hmo_request_tests — so this is the only place the rule can be enforced. Applies to staff
  // callers too: it is a data-integrity rule, not an authorization one.
  if (new Set(rows.map((r) => r.visit_id)).size > 1) {
    const error = new Error('An HMO request must cover tests from a single visit.');
    error.statusCode = 400;
    throw error;
  }

  if (!requestingUser?.roles?.includes('Client')) return; // staff roles are not ownership-restricted

  // patients.user_id is null for a walk-in registered at the front desk with no web account, so
  // this comparison denies rather than matches — which is the correct outcome for a Client.
  const ownsEvery = rows.every((r) => r.patient_user_id === requestingUser.userId);
  if (!ownsEvery) {
    const error = new Error('Access forbidden. One or more of these tests do not belong to your account.');
    error.statusCode = 403;
    throw error;
  }
}

class HmoService {
  async createRequest({ hmoProviderId, approvalCode, visitTestIds }, requestingUser) {
    await assertClientOwnsVisitTests(requestingUser, visitTestIds);

    return await hmoRepository.createRequestWithTests({
      hmoProviderId,
      approvalCode,
      visitTestIds: [...new Set(visitTestIds)]
    });
  }

  // UI/UX Modernization Phase 12: now Admin/SuperAdmin-only (see hmoRoutes.js) — audit-logged
  // like this app's other sensitive actions (payment refunds, staff account changes), since
  // approving HMO coverage is exactly the kind of decision that should leave a trace of who
  // signed off and when.
  async approveRequest(id, { approvalCode }, requestingUser) {
    const request = await hmoRepository.findRequestById(id);
    if (!request) {
      const error = new Error('HMO request not found');
      error.statusCode = 404;
      throw error;
    }

    const approved = await hmoRepository.approveRequest(id, { approvalCode });

    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'hmo_request.approved',
      entityType: 'hmo_request',
      entityId: id,
      description: `Approved HMO request for ${request.provider_name} (code: ${approvalCode})`
    });

    return approved;
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

  async updateTestApproval(hmoRequestTestId, approvalStatus, requestingUser) {
    const updated = await hmoRepository.updateTestApprovalStatus(hmoRequestTestId, approvalStatus);

    await auditService.log({
      actorId: requestingUser?.userId,
      action: approvalStatus === 'Approved' ? 'hmo_request_test.approved' : 'hmo_request_test.rejected',
      entityType: 'hmo_request_test',
      entityId: hmoRequestTestId,
      description: `Set test approval status to ${approvalStatus} for HMO request test #${hmoRequestTestId}`
    });

    return updated;
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
