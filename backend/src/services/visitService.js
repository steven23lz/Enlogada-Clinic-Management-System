const visitRepository = require('../repositories/visitRepository');
const notificationService = require('./notificationService');
const { staffRolesForCategories } = require('../constants/modality');

const VALID_VISIT_STATUSES = ['Pending', 'Processing', 'Completed', 'Cancelled'];

// Why a visit could not be released, in a form the caller can turn into a message. Kept as
// codes rather than prose so the payment path, the check-in path and the manual-status path
// can each phrase the same condition in terms their own user understands.
const RELEASE_BLOCKED = {
  UNPAID: 'unpaid',
  UNCONFIRMED: 'unconfirmed',
  ALREADY_RELEASED: 'already_released',
  NOT_RELEASABLE: 'not_releasable'
};

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

  /**
   * THE release rule. A visit becomes 'Processing' — which is the single thing that makes its
   * tickets visible to the Ultrasound/X-Ray/Laboratory worklists — only when BOTH hold:
   *
   *   1. the visit has a 'Paid' payment (online via GCash/Maya, or recorded at the counter),
   *   2. staff have confirmed it: an Appointment must have been QR-scanned/checked in by a
   *      receptionist; a walk-in is confirmed by having been registered at the front desk.
   *
   * Whichever condition is satisfied last triggers the release, so both real-world routes
   * converge here:
   *
   *   Online   : book -> pay (GCash/Maya) -> receptionist scans QR  -> released
   *   Walk-in  : register at desk -> cashier confirms payment       -> released
   *
   * Idempotent and safe to call speculatively from either path — it reports what happened
   * rather than throwing, because "not ready yet" is a normal outcome, not an error.
   */
  async releaseVisitIfReady(visitId) {
    const readiness = await visitRepository.findReleaseReadiness(visitId);
    if (!readiness) {
      const error = new Error('Visit not found');
      error.statusCode = 404;
      throw error;
    }

    if (readiness.status === 'Processing') {
      return { released: false, reason: RELEASE_BLOCKED.ALREADY_RELEASED, visit: readiness };
    }
    if (readiness.status !== 'Pending') {
      return { released: false, reason: RELEASE_BLOCKED.NOT_RELEASABLE, visit: readiness };
    }
    if (!readiness.is_paid) {
      return { released: false, reason: RELEASE_BLOCKED.UNPAID, visit: readiness };
    }
    if (!readiness.is_confirmed) {
      return { released: false, reason: RELEASE_BLOCKED.UNCONFIRMED, visit: readiness };
    }

    const visit = await visitRepository.releaseVisitToModalities(visitId);
    if (!visit) {
      // Lost the race to a concurrent caller, which has already sent the notification.
      return { released: false, reason: RELEASE_BLOCKED.ALREADY_RELEASED, visit: readiness };
    }

    await this.notifyModalitiesOfRelease(visitId, readiness);
    return { released: true, visit };
  }

  // "The ticket pops up for the appointed modality" — routed by the categories actually
  // attached to this visit, so an Ultrasound department isn't paged about a blood test.
  // Receptionist is included because the front desk owns the queue board and needs to see the
  // ticket move off their side. Fire-and-forget, like every other notifyRoles call.
  async notifyModalitiesOfRelease(visitId, visitInfo) {
    const categories = await visitRepository.findTestCategoriesForVisit(visitId);
    const modalityRoles = staffRolesForCategories(categories);
    if (modalityRoles.length === 0) return;

    await notificationService.notifyRoles([...modalityRoles, 'Receptionist'], {
      title: 'Ticket Released to Your Department',
      message: `Queue #${visitInfo.queue_number} — ${visitInfo.first_name} ${visitInfo.last_name} (${categories.join(', ')})`,
      type: 'info'
    });
  }

  async updateStatus(id, status, requestingUser) {
    if (!VALID_VISIT_STATUSES.includes(status)) {
      const error = new Error(`Invalid visit status. Must be one of: ${VALID_VISIT_STATUSES.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }

    const visit = await visitRepository.findVisitById(id);
    if (!visit) {
      const error = new Error('Visit not found');
      error.statusCode = 404;
      throw error;
    }

    // 'Processing' is not a status anyone gets to set by hand — it means "released to the
    // modalities", and that decision belongs to the release rule alone. Without this guard the
    // gate is only a UI convention: any receptionist token could PATCH an unpaid, unconfirmed
    // visit straight onto the Ultrasound worklist. SuperAdmin/Admin may still force it,
    // matching the RBAC bypass convention used throughout this codebase.
    const isPrivileged = requestingUser?.roles?.some((r) => r === 'SuperAdmin' || r === 'Admin');
    if (status === 'Processing') {
      if (!isPrivileged) {
        const outcome = await this.releaseVisitIfReady(id);
        if (outcome.released) return outcome.visit;
        if (outcome.reason === RELEASE_BLOCKED.ALREADY_RELEASED) return visit;

        const error = new Error(
          outcome.reason === RELEASE_BLOCKED.UNPAID
            ? 'This visit cannot be sent to the modalities until payment is confirmed.'
            : outcome.reason === RELEASE_BLOCKED.UNCONFIRMED
              ? 'This appointment must be checked in at the front desk before it can be sent to the modalities.'
              : `A ${visit.status} visit cannot be sent to the modalities.`
        );
        error.statusCode = 409;
        throw error;
      }

      // Privileged override: still perform the real release (the same atomic write that flips
      // visit_tests from Pending/Approved to Processing), just without the payment/confirmation
      // gate. A bare `updateVisitStatus` here would only flip patient_visits.status, leaving
      // every visit_test behind at 'Pending'/'Approved' — invisible to findPendingByCategory's
      // `vt.status IN ('Processing', 'Waiting for Release')` filter — so the override would look
      // like it worked while no ticket actually reached any modality worklist.
      if (visit.status === 'Pending') {
        const released = await visitRepository.releaseVisitToModalities(id);
        if (released) {
          await this.notifyModalitiesOfRelease(id, visit);
          return released;
        }
      }
    }

    return await visitRepository.updateVisitStatus(id, status);
  }

  async getVisitHistory(patientId) {
    return await visitRepository.findVisitsByPatientId(patientId);
  }
}

module.exports = new VisitService();
module.exports.RELEASE_BLOCKED = RELEASE_BLOCKED;
