const queueCallRepository = require('../repositories/queueCallRepository');
const { STATIONS, CASHIER, stationFor } = require('../constants/queueStations');
const { departmentsForUser, userCoversCategory } = require('../constants/modality');
const { summarise } = require('../utils/nowServing');

/** A display asks every few seconds, so this long without one means no screen is open. */
const DISPLAY_SEEN_MS = 20 * 1000;

const fail = (status, message) => {
  const error = new Error(message);
  error.statusCode = status;
  return error;
};

const holds = (user, permission) =>
  (user?.roles || []).includes('SuperAdmin') || (user?.permissions || []).includes(permission);

/**
 * Calling a patient, and the waiting-room screen that shows it. [1.149.0]
 *
 * The Desk's call button only spoke the number on the reception PC's own speakers: nothing recorded
 * it, the other stations had nothing like it, and a patient in the waiting room had to catch it by
 * ear. A call is now a row (who, to which station, when), and `?display=queue` shows each station's
 * current ticket on a TV. A call changes no status: it asks a patient to come, it does not say that
 * they did.
 *
 * Only the ticket reaches the screen. Ticket numbers restart each day, so a ticket from an earlier
 * day cannot be called: it would send someone else holding today's same number.
 */
class QueueCallService {
  constructor() {
    this.displaySeenAt = 0;
  }

  /** The public screen's read. Remembers that a screen is open, for the reply to the next call. */
  async nowServing(now = Date.now()) {
    this.displaySeenAt = now;
    // Nothing that changes between calls (no server time), so an unchanged board is a 304.
    return summarise(await queueCallRepository.findTodays(), STATIONS);
  }

  /**
   * @returns the call, and `displayOpen`: whether a screen has asked lately. Without one nobody can
   *   see the call, so the calling PC says it aloud and tells the person pressing the button.
   */
  async call({ visitId, station }, user, now = Date.now()) {
    const where = stationFor(station);
    if (!where) throw fail(400, `Call a patient to one of: ${STATIONS.map((s) => s.label).join(', ')}.`);
    const id = Number(visitId);
    if (!Number.isInteger(id) || id <= 0) throw fail(400, 'Say which visit to call.');

    if (!holds(user, where.permission)) {
      throw fail(403, `Your account does not work at ${where.label}, so it cannot call patients there.`);
    }
    if (where.department) {
      const departments = user.departments ?? departmentsForUser(user);
      if (!userCoversCategory(departments, where.key)) {
        throw fail(403, `Your account does not work at ${where.label}, so it cannot call patients there.`);
      }
    }

    const visit = await queueCallRepository.findVisitForCall(id, where.key);
    if (!visit) throw fail(404, 'Visit not found.');
    if (!visit.queue_number) throw fail(409, 'This patient has no ticket yet: check them in first.');
    if (!visit.from_today) {
      throw fail(409, "This ticket is from an earlier day, and today's numbers started again, so someone else may hold it. Call this patient by name.");
    }
    if (where.department) {
      if (!visit.has_work) throw fail(409, `This patient has nothing waiting at ${where.label}.`);
    } else {
      if (!visit.in_queue) throw fail(409, "This patient is no longer in today's queue.");
      if (where.key === CASHIER && visit.is_paid) throw fail(409, 'This visit has already been paid.');
    }

    const call = await queueCallRepository.create({ visitId: id, station: where.key, calledBy: user.userId });
    return {
      id: call.id,
      station: where.key,
      label: where.label,
      ticket: visit.queue_number,
      calledAt: call.called_at,
      displayOpen: now - this.displaySeenAt < DISPLAY_SEEN_MS,
    };
  }
}

module.exports = new QueueCallService();
