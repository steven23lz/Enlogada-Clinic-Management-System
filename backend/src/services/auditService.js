const auditRepository = require('../repositories/auditRepository');
const userRepository = require('../repositories/userRepository');
const logger = require('../config/logger');

// Feature Gap Plan Phase D: a shared logging hook for the sensitive actions this session's
// other phases introduced (payment refund/cancel, staff password reset/status toggle, HMO
// provider changes, result corrections). Called fire-and-forget from each service after its
// own write succeeds — an audit-log failure must never roll back or fail the real operation,
// so this only ever logs and swallows, never throws.
class AuditService {
  // req.user (the JWT payload) only carries {userId, roles, permissions} — no name — so this
  // resolves the actor's display name itself rather than making every call site look it up.
  async log({ actorId, action, entityType, entityId, description }) {
    try {
      let actorName = 'Unknown';
      if (actorId) {
        const actor = await userRepository.findById(actorId);
        if (actor) actorName = `${actor.first_name} ${actor.last_name}`;
      }
      await auditRepository.create({ actorId, actorName, action, entityType, entityId, description });
    } catch (err) {
      logger.error('Failed to write audit log entry:', err);
    }
  }

  async getRecentActivity({ page = 1, limit = 25 }) {
    const offset = (page - 1) * limit;
    const { entries, total } = await auditRepository.findRecent({ limit, offset });
    return { entries, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }
}

module.exports = new AuditService();
