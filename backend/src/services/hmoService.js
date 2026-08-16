const fs = require('fs');
const path = require('path');
const hmoRepository = require('../repositories/hmoRepository');
const auditService = require('./auditService');
const { HMO_CARD_UPLOAD_ROOT } = require('../config/upload');

// Mirrors testService.js's assertClientOwnsVisit, which exists for the same reason: that endpoint
// also authorizes the Client role for self-service booking and originally trusted whatever ids the
// caller sent. This endpoint opened to Clients when online booking needed it, and without this a
// client could attach an HMO claim to a stranger's tests — a claim against someone else's bill,
// filed under their own provider and LOA code.
//
// Validation is all-or-nothing and runs before any write. Filtering the caller's ids down to the
// ones they own would silently under-claim: a three-test claim quietly becoming a two-test claim
// bills the patient out of pocket for the third with nothing on screen to explain it.
async function assertClientOwnsVisitTests(requestingUser, visitTestIds, client) {
  const uniqueIds = [...new Set(visitTestIds)];
  const rows = await hmoRepository.findOwnershipInfoByVisitTestIds(uniqueIds, client);

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

// Every HMO claim must carry evidence, and what counts as evidence depends on who is filing it.
//
// A client booking online is not in the building, so the photo of their card is the only thing
// the clinic can look at before approving coverage. A receptionist filing the same claim has the
// physical card in their hand — a photo would add nothing their own eyes did not already verify,
// and demanding one mid-queue would slow a working desk to fix a problem it does not have. They
// are exempt from uploading, not from accountability: their user id is recorded as the verifier.
//
// Either way the claim is reviewable, and chk_hmo_request_card_evidence enforces that at the
// database, covering routes and scripts that do not exist yet.
const CARD_EXEMPT_ROLES = ['SuperAdmin', 'Admin', 'Receptionist', 'Cashier'];

function resolveCardEvidence(requestingUser, cardFile) {
  // Keyed on HOLDING a staff role, not on the absence of Client. Combined-role accounts are a
  // supported thing here, and a receptionist who is also a patient of the clinic is ordinary —
  // testing for Client would refuse her the desk exemption while she is standing at the desk
  // holding the card.
  const isStaff = Boolean(requestingUser?.roles?.some((r) => CARD_EXEMPT_ROLES.includes(r)));

  if (cardFile) {
    return {
      filePath: cardFile.filename,
      originalName: cardFile.originalname,
      mimeType: cardFile.mimetype,
      sizeBytes: cardFile.size,
      // Staff who do attach a photo are still recorded as having seen the card in person.
      verifiedBy: isStaff ? (requestingUser?.userId ?? null) : null
    };
  }

  if (!isStaff) {
    const error = new Error('Please attach a photo of your HMO card to claim HMO coverage.');
    error.statusCode = 400;
    throw error;
  }

  // Staff, no photo: the attestation IS the evidence, so an unidentifiable caller cannot
  // produce a valid claim. Fails here with a readable message rather than as a 23514 further in.
  if (!requestingUser?.userId) {
    const error = new Error('Cannot record who confirmed this HMO card.');
    error.statusCode = 400;
    throw error;
  }
  return { verifiedBy: requestingUser.userId };
}

class HmoService {
  async createRequest({ hmoProviderId, approvalCode, visitTestIds, cardFile = null }, requestingUser, client = undefined) {
    // Skipped when called from inside the booking transaction: the visit_tests were minted by
    // that same transaction from a patient whose ownership was already asserted, and the check
    // reads on a different connection where those rows are not yet visible.
    if (client === undefined) {
      await assertClientOwnsVisitTests(requestingUser, visitTestIds);
    }

    const card = resolveCardEvidence(requestingUser, cardFile);

    const request = await hmoRepository.createRequestWithTests({
      hmoProviderId,
      approvalCode,
      visitTestIds: [...new Set(visitTestIds)],
      card
    }, client === undefined ? null : client);

    // Approving coverage is already audited; the evidence the approval rests on should be too.
    // Fire-and-forget, like every other auditService.log call — it never fails the operation.
    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'hmo_request.evidence_recorded',
      entityType: 'hmo_request',
      entityId: request.id,
      description: card.filePath
        ? 'HMO card image attached to the claim'
        : 'Physical HMO card confirmed at the desk'
    });

    return request;
  }

  // Streams the card image back. Never a static path: an HMO card carries a name, a member
  // number and often a photo. Mirrors resultService.getResultFile, including the deliberate
  // handling of a row that says a file exists when the disk disagrees.
  async getCardFile(requestId, requestingUser) {
    const row = await hmoRepository.findCardByRequestId(requestId);
    if (!row) {
      const error = new Error('HMO request not found');
      error.statusCode = 404;
      throw error;
    }

    if (requestingUser?.roles?.includes('Client')) {
      if (row.patient_user_id !== requestingUser.userId) {
        const error = new Error('Access forbidden. This HMO request does not belong to your account.');
        error.statusCode = 403;
        throw error;
      }
    }

    if (row.card_purged_at) {
      const error = new Error('This card image was removed under the clinic\'s retention policy.');
      error.statusCode = 410;
      throw error;
    }

    if (!row.card_file_path) {
      const error = new Error('No card image was attached to this request. It was confirmed in person at the desk.');
      error.statusCode = 404;
      throw error;
    }

    const absolutePath = path.join(HMO_CARD_UPLOAD_ROOT, row.card_file_path);
    if (!fs.existsSync(absolutePath)) {
      const error = new Error('The card image could not be found on the server.');
      error.statusCode = 404;
      throw error;
    }

    return {
      absolutePath,
      originalName: row.card_original_name || 'hmo-card',
      mimeType: row.card_mime_type || 'application/octet-stream'
    };
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
