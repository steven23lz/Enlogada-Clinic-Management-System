const fs = require('fs');
const path = require('path');
const notificationRepository = require('../repositories/notificationRepository');
const auditRepository = require('../repositories/auditRepository');
const hmoRepository = require('../repositories/hmoRepository');
const auditService = require('./auditService');
const patientRepository = require('../repositories/patientRepository');
const env = require('../config/environment');
const { HMO_CARD_UPLOAD_ROOT } = require('../config/upload');
const logger = require('../config/logger');

/**
 * What the clinic keeps, and for how long. [1.148.0]
 *
 * Three retention passes were scripts somebody had to schedule (pruneNotifications.js,
 * pruneAuditLog.js, pruneHmoCards.js), so on a clinic PC they never ran and those tables grew
 * forever. The server now runs them once a day (jobs/retentionScheduler.js), with the windows each
 * script already set out the reasons for. The scripts still run by hand, through this service, so
 * the two can never delete different rows.
 */
const RETENTION = Object.freeze({
  notificationsReadDays: 30,
  notificationsUnreadDays: 90,
  auditPhiReadDays: 730,     // "who opened this patient's record?": 2 years
  auditOtherDays: 3650,      // money, accounts, results: 10 years, like the records they describe [1.162.0]
  recordYears: 10,           // a patient record with nothing happening for this long is archived, never deleted
  hmoCardDays: 365,          // evidence for one claim, long settled by then
});

class RetentionService {
  async pruneNotifications({ readDays = RETENTION.notificationsReadDays, unreadDays = RETENTION.notificationsUnreadDays } = {}) {
    const result = await notificationRepository.pruneOlderThan({ readAfterDays: readDays, unreadAfterDays: unreadDays });
    return {
      readRows: result.readRowsDeleted,
      staleRows: result.staleRowsDeleted,
      events: result.eventsDeleted,
    };
  }

  async auditLogPastRetention({ phiDays = RETENTION.auditPhiReadDays, otherDays = RETENTION.auditOtherDays } = {}) {
    return auditRepository.countPastRetention({ phiDays, otherDays });
  }

  async pruneAuditLog({ phiDays = RETENTION.auditPhiReadDays, otherDays = RETENTION.auditOtherDays } = {}) {
    return auditRepository.deletePastRetention({ phiDays, otherDays });
  }

  async hmoCardsPastRetention({ days = RETENTION.hmoCardDays } = {}) {
    return hmoRepository.findCardsPastRetention(days);
  }

  /**
   * Removes HMO card images past the window. The row first: it is the record of whether a card is
   * on file, and a stamped row beside a file that survives is recoverable, where a deleted file
   * under a row still claiming it is a broken link.
   */
  async pruneHmoCards({ days = RETENTION.hmoCardDays } = {}) {
    const due = await hmoRepository.findCardsPastRetention(days);
    let removed = 0;
    for (const row of due) {
      await hmoRepository.markCardPurged(row.id);
      try {
        fs.unlinkSync(path.join(HMO_CARD_UPLOAD_ROOT, row.card_file_path));
      } catch (err) {
        if (err.code !== 'ENOENT') logger.warn(`HMO card for request #${row.id} could not be removed: ${err.message}`);
      }
      removed += 1;
    }
    return removed;
  }

  /**
   * The clinic keeps records for 10 years, then they are archived, automatically or by the Archive button.
   * [1.162.0] Archived is still kept: out of the Desk's search, readable, and restorable on Patient Records.
   * Restoring a record counts as activity, so the pass does not take it straight back.
   */
  async archiveDormantRecords({ years = RETENTION.recordYears } = {}) {
    const archived = await patientRepository.archiveDormant(years);
    for (const p of archived) {
      await auditService.log({
        actorName: 'System (retention)',
        action: 'patient.auto_archived',
        entityType: 'patient',
        entityId: p.id,
        description: `Archived ${p.first_name} ${p.last_name}'s record: nothing has happened on it for ${years} years. Nothing was deleted.`,
      });
    }
    return archived.map((p) => p.id);
  }

  /** The daily pass. One Activity Log line when it removed anything, so the removals are on record. */
  async runAll() {
    const notifications = await this.pruneNotifications();
    const auditRows = await this.pruneAuditLog();
    const hmoCards = await this.pruneHmoCards();
    if (env.RECORD_AUTO_ARCHIVE) await this.archiveDormantRecords();
    const summary = { notifications, auditRows, hmoCards };

    const parts = [
      notifications.readRows + notifications.staleRows && `${notifications.readRows + notifications.staleRows} old notification(s)`,
      auditRows && `${auditRows} Activity Log entr${auditRows === 1 ? 'y' : 'ies'} past ${RETENTION.auditPhiReadDays / 365} or ${Math.round(RETENTION.auditOtherDays / 365)} years`,
      hmoCards && `${hmoCards} HMO card photo(s) older than a year`,
    ].filter(Boolean);
    if (parts.length) {
      await auditService.log({
        actorName: 'System (retention)',
        action: 'system.retention_pass',
        entityType: 'retention',
        entityId: null,
        description: `Removed ${parts.join(', ')}.`,
      });
    }
    return summary;
  }
}

module.exports = new RetentionService();
module.exports.RETENTION = RETENTION;
