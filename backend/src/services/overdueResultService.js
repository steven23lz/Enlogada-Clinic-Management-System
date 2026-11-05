const resultRepository = require('../repositories/resultRepository');
const notificationService = require('./notificationService');
const appointmentService = require('./appointmentService');
const { TURNAROUND_TARGET_MINUTES } = require('../config/turnaroundTargets');
const { formatTime12 } = require('../constants/clockFormat');
const { localDateStr } = require('../utils/csvExport');
const { closingWindow } = require('../utils/closingNotice');
const {
  DIAGNOSTIC_CATEGORIES, CATEGORY_TO_STAFF_ROLE, categoryLabel, departmentsForUser, userCoversCategory,
} = require('../constants/modality');

/**
 * A patient in the queue with no uploaded test result. [1.163.0] Steven's rule, every department:
 *
 *   3:15 PM in the queue: if no result is uploaded by 4:15 PM, ping the department, Admin and SuperAdmin.
 *   Uploaded before then: nobody is pinged.
 *   4:17 PM in the queue: its hour runs past the 5:00 PM close, so 15 minutes before closing (4:45 PM) every
 *   test still with no result pings, whatever its own hour says (utils/closingNotice.js).
 *
 * "In the queue" is the worklist's own rule: paid and here, whichever came last. A booking not yet checked
 * in, or a walk-in not yet paid, has started no clock.
 *
 * Two parts, because a bell can be missed: `sweep` rings it once per patient and department, and `list`
 * feeds the banner that stays on every screen until the result is uploaded, and cannot be dismissed.
 */
class OverdueResultService {
  async closingNow(now = new Date()) {
    const day = await appointmentService.resolveDay(localDateStr(now));
    return closingWindow(day, now.getHours() * 60 + now.getMinutes());
  }

  /**
   * Rings the bell for whoever newly went over. Safe beside other servers: each test is claimed first.
   * In the last 15 minutes it is the closing call and covers every test with no result; one that has
   * had it is not rung again that day by its own hour running out, minutes later.
   *
   * @param {{ closing?: { inWindow: boolean, closesAt: string|null } }} [options]  for a test, a clock
   * @returns {Promise<number>} how many patients were told about
   */
  async sweep({ closing = null } = {}) {
    const window = closing || await this.closingNow();
    let notified = 0;
    for (const department of DIAGNOSTIC_CATEGORIES) {
      const minutes = TURNAROUND_TARGET_MINUTES[department];
      if (!minutes) continue;
      const rows = window.inWindow
        ? await resultRepository.claimBeforeClosing(department)
        : await resultRepository.claimOverdue(department, minutes);
      const byVisit = new Map();
      for (const row of rows) {
        if (!byVisit.has(row.visit_id)) byVisit.set(row.visit_id, { ...row, tests: [] });
        byVisit.get(row.visit_id).tests.push(row.test_name);
      }
      const label = categoryLabel(department);
      for (const visit of byVisit.values()) {
        const ticket = visit.queue_number ? `Ticket ${visit.queue_number}, ` : '';
        await notificationService.notifyRoles([CATEGORY_TO_STAFF_ROLE[department], 'Admin', 'SuperAdmin'], {
          title: `No test result uploaded for: ${ticket}${visit.first_name} ${visit.last_name}`,
          target: { kind: 'worklist', departments: [department], find: `${visit.first_name} ${visit.last_name}` },
          message: window.inWindow
            ? `${visit.tests.join(', ')} (${label}). The clinic closes at ${formatTime12(window.closesAt)}.`
            : `${visit.tests.join(', ')} (${label}). ${minutes} minutes have passed since they joined the queue.`,
          type: 'critical',
        });
        notified += 1;
      }
    }
    return notified;
  }

  /** What this person answers for, on the banner: their own departments, or all of them for an Admin. */
  async list(user) {
    const departments = user.departments ?? departmentsForUser(user);
    const window = await this.closingNow();
    const out = [];
    for (const department of DIAGNOSTIC_CATEGORIES) {
      const minutes = TURNAROUND_TARGET_MINUTES[department];
      if (!minutes || !userCoversCategory(departments, department)) continue;
      const rows = await resultRepository.findOverdue(department, window.inWindow ? 0 : minutes);
      if (rows.length === 0) continue;
      out.push({
        department,
        label: categoryLabel(department),
        minutes,
        closesAt: window.inWindow ? formatTime12(window.closesAt) : null,
        patients: rows.map((r) => ({
          visitTestId: r.visit_test_id,
          ticket: r.queue_number,
          name: `${r.first_name} ${r.last_name}`,
          test: r.test_name,
          waited: r.waited_minutes,
        })),
      });
    }
    return out;
  }
}

module.exports = new OverdueResultService();
