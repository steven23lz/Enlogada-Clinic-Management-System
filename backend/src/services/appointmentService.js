const db = require('../config/database');
const appointmentRepository = require('../repositories/appointmentRepository');
const visitRepository = require('../repositories/visitRepository');
const scheduleRepository = require('../repositories/scheduleRepository');
const testRepository = require('../repositories/testRepository');
const patientService = require('./patientService');
const notificationService = require('./notificationService');
const testService = require('./testService');
const hmoService = require('./hmoService');
const { discardHmoCard } = require('../config/upload');
const visitService = require('./visitService');
const auditService = require('./auditService');
const appointmentEmailService = require('./appointmentEmailService');
const logger = require('../config/logger');
const { normaliseReferral } = require('./referralService');

async function assertClientOwnsPatient(requestingUser, patientId) {
  if (!requestingUser?.roles?.includes('Client')) return; // staff roles are not ownership-restricted
  const patient = await patientService.getPatientById(patientId);
  if (patient.user_id !== requestingUser.userId) {
    const error = new Error('Access forbidden. This patient profile does not belong to your account.');
    error.statusCode = 403;
    throw error;
  }
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Is this date/time a slot the clinic actually offers? Returns that day's operating hours, which
 * the caller needs anyway for the capacity ceiling.
 *
 * Shared by booking and rescheduling because the two must agree. A reschedule that skipped this
 * would let a patient move a booking to a Sunday, or to 19:00 — through a UI that never offered
 * either, but the API is reachable directly and the check is the only thing that makes the
 * availability screen more than a suggestion.
 */
async function assertSlotWithinOperatingHours(scheduledDate, scheduledTime) {
  const dayOfWeek = new Date(`${scheduledDate}T12:00:00Z`).getUTCDay();
  const hours = await scheduleRepository.findOperatingHoursForDay(dayOfWeek);

  if (!hours || !hours.is_open) {
    const error = new Error('The clinic is closed on the selected date.');
    error.statusCode = 409;
    throw error;
  }
  const requestedMinutes = timeToMinutes(scheduledTime);
  if (requestedMinutes < timeToMinutes(hours.open_time) || requestedMinutes >= timeToMinutes(hours.close_time)) {
    const error = new Error('The selected time is outside clinic operating hours.');
    error.statusCode = 409;
    throw error;
  }
  return hours;
}

function minutesToTime(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function todayLocalDateString() {
  return formatDateOnly(new Date());
}

/**
 * A DATE column as the calendar date it actually is.
 *
 * node-pg parses DATE at LOCAL midnight, so toISOString() on it returns the previous day
 * everywhere east of UTC — in Philippine time, every date in the system, always. Local getters,
 * same rule as frontend/src/lib/date.js.
 */
function formatDateOnly(value) {
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

class AppointmentService {
  async getAvailableSlots(date) {
    const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
    const hours = await scheduleRepository.findOperatingHoursForDay(dayOfWeek);

    if (!hours || !hours.is_open) {
      return { date, isOpen: false, slots: [] };
    }

    const openMinutes = timeToMinutes(hours.open_time);
    const closeMinutes = timeToMinutes(hours.close_time);
    const interval = hours.slot_interval_minutes;
    const maxConcurrent = hours.max_concurrent_bookings;

    const bookings = await scheduleRepository.countBookingsByTimeForDate(date);
    const bookedCounts = {};
    bookings.forEach(b => {
      bookedCounts[minutesToTime(timeToMinutes(b.scheduled_time))] = b.cnt;
    });

    const isToday = date === todayLocalDateString();
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const slots = [];
    for (let m = openMinutes; m < closeMinutes; m += interval) {
      const time = minutesToTime(m);
      const bookedCount = bookedCounts[time] || 0;
      const isPast = isToday && m <= nowMinutes;
      slots.push({ time, available: bookedCount < maxConcurrent && !isPast });
    }

    return { date, isOpen: true, slots };
  }

  // Books an appointment and everything that belongs to it in ONE transaction.
  //
  // The tests and the optional HMO request used to be two further HTTP calls made by the browser
  // after this one had already committed. A failure in either left an appointment that existed
  // while the patient was told the booking failed -- and because a non-cancelled appointment
  // occupies its slot, that phantom then refused the patient's own retry as "no longer
  // available". Both now live inside this transaction, so a booking either exists completely or
  // not at all.
  async createAppointment({
    patientId, scheduledDate, scheduledTime, notes, createdBy, requestingUser,
    testIds = [], hmo = null, hmoCardFile = null, referral = null
  }) {
    // db.withTransaction rather than a hand-managed db.pool.connect(). Everything underneath —
    // testService.attachTests, hmoService.createRequest and the auditService.log inside it — runs
    // on this one connection automatically, so nothing under the advisory lock can check out a
    // second connection while holding the first. With a bounded pool that is a deadlock: ten
    // concurrent bookings hold all ten connections, each waiting for one that will never come
    // free. It also removes the `committed` flag this used to need — the post-commit work below
    // is now structurally outside the transaction rather than inside its try.
    let outcome;
    try {
      // Inside the try, though it runs before the transaction: multer has already written the card
      // by the time this method is entered, so a 403 here would otherwise leave it on disk forever.
      await assertClientOwnsPatient(requestingUser, patientId);

      outcome = await db.withTransaction(async () => {
        // 1. Validate the requested slot against clinic operating hours
        const hours = await assertSlotWithinOperatingHours(scheduledDate, scheduledTime);

        // 2. Serialize concurrent bookings for the same slot (no row exists yet to lock
        //    on an empty slot, so an advisory lock closes that race window).
        //    Everything from here to COMMIT runs while other bookings for this slot wait, so keep
        //    it short -- in particular, never put a file write or a network call in here.
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${scheduledDate}|${scheduledTime}`]);

        // 3. Has this patient already booked this exact slot? Checked inside the lock, so it is
        //    race-free, and BEFORE the capacity check below -- which matters at the seeded
        //    max_concurrent_bookings of 1, where the patient's own booking would otherwise be the
        //    thing that makes the slot look full. Returning the existing booking is what makes a
        //    retry after a lost response safe: the patient re-enters the same patient, date and
        //    time, which is a natural idempotency key they regenerate for free.
        //
        //    Keyed on the patient, not the account: one account owns several profiles, so two
        //    dependents at the same time are two different patients and correctly both allowed.
        const existing = await appointmentRepository.findActiveByPatientAndSlot(
          { patientId, scheduledDate, scheduledTime }
        );
        if (existing) {
          const visitTests = testIds.length
            ? await testService.attachTests(existing.patient_visit_id, testIds)
            : await testRepository.findTestsByVisitId(existing.patient_visit_id);

          return { appointment: existing, visitTests, hmoRequest: null, alreadyBooked: true };
        }

        const { rows } = await db.query(
          `SELECT COUNT(*)::int AS cnt FROM appointments WHERE scheduled_date = $1 AND scheduled_time = $2 AND status <> 'Cancelled'`,
          [scheduledDate, scheduledTime]
        );
        if (rows[0].cnt >= hours.max_concurrent_bookings) {
          const error = new Error('This time slot is no longer available. Please select a different time.');
          error.statusCode = 409;
          throw error;
        }

        // 4. Create the patient_visit record first (visit_type = 'Appointment')
        //
        // The referring physician goes on at creation rather than being written back afterwards
        // by hmoService: this path is minting the visit, so it can simply record it, and
        // assertVisitNamesReferrer then finds the visit already named one and has nothing to do.
        const queueNumber = await visitRepository.getNextQueueNumber();
        const visit = await visitRepository.createVisit({
          patientId,
          visitType: 'Appointment',
          notes,
          queueNumber,
          createdBy,
          ...normaliseReferral(referral || {})
        });

        // 5. Create the appointment record linked to the visit
        const appointment = await appointmentRepository.createAppointment({
          patientVisitId: visit.id,
          scheduledDate,
          scheduledTime,
          notes
        });

        // 6. Attach the chosen tests, and the HMO claim if one was made. Order matters:
        //    hmo_request_tests references visit_tests.
        const visitTests = testIds.length
          ? await testService.attachTests(visit.id, testIds)
          : [];

        let hmoRequest = null;
        if (hmo && visitTests.length) {
          hmoRequest = await hmoService.createRequest({
            hmoProviderId: hmo.providerId,
            approvalCode: hmo.approvalCode || null,
            visitTestIds: visitTests.map((vt) => vt.id),
            cardFile: hmoCardFile
          }, requestingUser, { ownershipAlreadyAsserted: true });
        }

        return {
          appointment: { ...appointment, queue_number: visit.queue_number },
          visitTests,
          hmoRequest,
          alreadyBooked: false,
          queueNumber: visit.queue_number
        };
      });
    } catch (err) {
      // Nothing committed, so nothing references the card and the bytes multer wrote are
      // unreachable. This is the ONLY place the card is discarded on failure: past this catch the
      // transaction has committed, and deleting the file would break a booking that exists.
      discardHmoCard(hmoCardFile);
      throw err;
    }

    // ── Committed from here. Nothing below may delete the card or fail the booking. ──────────
    if (outcome.alreadyBooked) {
      // A retry re-sends the card the original booking already carries, and this path files no
      // new claim for it to attach to. Drop the bytes rather than letting a re-submission swap
      // the evidence under a claim an Admin may already have reviewed.
      discardHmoCard(hmoCardFile);
      // No notification either: staff were already told about this booking when it was made.
      return outcome;
    }

    // Module 18 (Notification): Receptionist owns intake/check-in for a booked appointment;
    // Admin/SuperAdmin have standing oversight (matches the existing Appointments Oversight
    // page). Outside the transaction so a notification failure can never roll back a real
    // booking — and notifyRoles swallows its own errors, so it cannot fail the request either.
    await notificationService.notifyRoles(['Receptionist', 'Admin', 'SuperAdmin'], {
      title: 'New Appointment Booked',
      message: `Queue #${outcome.queueNumber} — ${scheduledDate} at ${scheduledTime}`,
      type: 'info'
    });

    // And tell the patient. [1.24.0] Staff got a notification and the patient got nothing but a
    // confirmation screen that vanishes when the tab closes — taking the reference the front desk
    // asks for with it. The email also carries the preparation instructions, which is the part
    // that stops somebody arriving unable to be tested.
    await this.emailBookingConfirmation(outcome.appointment.id);

    return outcome;
  }

  async verifyByReference(reference) {
    const appointment = await appointmentRepository.findByReference(reference);
    if (!appointment) {
      const error = new Error('Appointment not found. Invalid reference code.');
      error.statusCode = 404;
      throw error;
    }
    return appointment;
  }

  async getClientBookings(userId) {
    return await appointmentRepository.findByPatientUserId(userId);
  }

  async getAllAppointments(filters) {
    return await appointmentRepository.findAll(filters);
  }

  async cancelAppointment(id, requestingUser) {
    const appointment = await appointmentRepository.findById(id);
    if (!appointment) {
      const error = new Error('Appointment not found');
      error.statusCode = 404;
      throw error;
    }

    await assertClientOwnsPatient(requestingUser, appointment.patient_id);

    if (appointment.status === 'Cancelled') {
      const error = new Error('Appointment is already cancelled');
      error.statusCode = 400;
      throw error;
    }

    // Cancelling the appointment and cancelling its visit is one decision, so it is one write.
    // Split, a failure on the second left the appointment Cancelled while its visit stayed active
    // — a phantom booking that the patient believes is cancelled and that the front desk still
    // sees in the queue, still counts toward the slot capacity check in bookAppointment, and
    // still appears on the cashier's billing list.
    // Read before the cancel: the context query joins visit_tests, and the row is easier to read
    // while the booking is still live than to reason about afterwards.
    const ctx = await appointmentRepository.findEmailContextById(id).catch(() => null);

    const updated = await db.withTransaction(async () => {
      const result = await appointmentRepository.updateAppointmentStatus(id, 'Cancelled');
      await visitRepository.updateVisitStatus(appointment.patient_visit_id, 'Cancelled');
      return result;
    });

    // After the commit. A patient who cancels needs a record that it actually happened, and one
    // whose appointment was cancelled *for* them needs to find out some way other than turning up.
    try {
      if (ctx) {
        await appointmentEmailService.sendCancellationNotice({
          to: ctx.email,
          patientName: `${ctx.first_name} ${ctx.last_name}`,
          reference: ctx.appointment_reference,
          date: ctx.scheduled_date,
          time: ctx.scheduled_time,
        });
      }
    } catch (err) {
      logger.error(`Cancellation email failed for appointment ${id}: ${err.message}`);
    }

    return updated;
  }

  /**
   * Emails the patient their own booking. [1.24.0]
   *
   * Wrapped rather than inlined at each call site because all three appointment emails share the
   * same shape — read the context, skip quietly if there is nobody to write to, never let a mail
   * problem surface as a failed booking. Every caller is past its COMMIT.
   */
  async emailBookingConfirmation(appointmentId) {
    try {
      const ctx = await appointmentRepository.findEmailContextById(appointmentId);
      if (!ctx) return;
      await appointmentEmailService.sendBookingConfirmation({
        to: ctx.email,
        patientName: `${ctx.first_name} ${ctx.last_name}`,
        reference: ctx.appointment_reference,
        date: ctx.scheduled_date,
        time: ctx.scheduled_time,
        queueNumber: ctx.queue_number,
        tests: ctx.tests || [],
      });
    } catch (err) {
      // The booking is already committed and correct. An email problem is not the patient's
      // problem and must not be reported as one.
      logger.error(`Booking confirmation email failed for appointment ${appointmentId}: ${err.message}`);
    }
  }

  /**
   * Moves an existing booking to a different slot.
   *
   * Cancel-and-rebook was the only way to change a booking, and it is not equivalent: between the
   * two calls the patient holds nothing, and at the seeded capacity of one patient per slot
   * somebody else can take the replacement in the gap. The patient ends up with no appointment
   * having started with one, which is a worse outcome than being told the new time is unavailable.
   * Here the move either happens or the original stands.
   *
   * Only a Pending booking can move. 'Confirmed' is the receptionist's check-in — the patient is
   * at the desk, so a new date is not what anyone means — and Completed / No Show / Cancelled are
   * all finished.
   */
  async rescheduleAppointment(id, { scheduledDate, scheduledTime }, requestingUser) {
    const appointment = await appointmentRepository.findById(id);
    if (!appointment) {
      const error = new Error('Appointment not found');
      error.statusCode = 404;
      throw error;
    }

    await assertClientOwnsPatient(requestingUser, appointment.patient_id);

    if (appointment.status !== 'Pending') {
      const error = new Error(
        appointment.status === 'Confirmed'
          ? 'This appointment has already been checked in and cannot be rescheduled.'
          : `A ${appointment.status.toLowerCase()} appointment cannot be rescheduled.`
      );
      error.statusCode = 409;
      throw error;
    }

    const previous = {
      date: formatDateOnly(appointment.scheduled_date),
      time: String(appointment.scheduled_time).slice(0, 5),
    };

    const updated = await db.withTransaction(async () => {
      const hours = await assertSlotWithinOperatingHours(scheduledDate, scheduledTime);

      // Same advisory lock as booking, on the same key, so a reschedule and a fresh booking
      // competing for the last place in a slot are serialised against each other rather than both
      // reading a stale count.
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${scheduledDate}|${scheduledTime}`]);

      // Another of this patient's bookings already sitting in the target slot. Refused rather
      // than merged: two bookings becoming one silently loses whatever was attached to this one.
      const clash = await appointmentRepository.findActiveByPatientAndSlot({
        patientId: appointment.patient_id, scheduledDate, scheduledTime,
      });
      if (clash && clash.id !== appointment.id) {
        const error = new Error('This patient already has a booking at that time.');
        error.statusCode = 409;
        throw error;
      }

      // Excluding itself, so moving to a different date at the same time of day is not blocked
      // by its own row.
      const taken = await appointmentRepository.countActiveInSlot({
        scheduledDate, scheduledTime, excludeId: appointment.id,
      });
      if (taken >= hours.max_concurrent_bookings) {
        const error = new Error('This time slot is no longer available. Please select a different time.');
        error.statusCode = 409;
        throw error;
      }

      const moved = await appointmentRepository.updateSchedule(id, { scheduledDate, scheduledTime });

      // Audited: a booking moving is a change to a commitment made to a patient, and when staff
      // do it on someone's behalf the record of who and when is the whole point. Low volume, so
      // none of the fan-out concern that keeps logPhiRead off worklists applies.
      await auditService.log({
        actorId: requestingUser?.userId,
        action: 'appointment.rescheduled',
        entityType: 'appointment',
        entityId: appointment.id,
        description:
          `${appointment.appointment_reference}: ${previous.date} ${previous.time} → ` +
          `${scheduledDate} ${String(scheduledTime).slice(0, 5)}`,
      });

      return moved;
    });

    // After the commit, and notifyRoles swallows its own errors, so a notification problem can
    // never report a completed move as failed.
    await notificationService.notifyRoles(['Receptionist', 'Admin', 'SuperAdmin'], {
      title: 'Appointment Rescheduled',
      message:
        `${appointment.first_name} ${appointment.last_name} — ${previous.date} ${previous.time} → ` +
        `${scheduledDate} ${String(scheduledTime).slice(0, 5)}`,
      type: 'info',
    });

    // The patient needs this one more than staff do, and especially when reception moved it on
    // their behalf over the phone — otherwise the only record of the new time is a conversation.
    try {
      const ctx = await appointmentRepository.findEmailContextById(id);
      if (ctx) {
        await appointmentEmailService.sendRescheduleNotice({
          to: ctx.email,
          patientName: `${ctx.first_name} ${ctx.last_name}`,
          reference: ctx.appointment_reference,
          from: previous,
          moved: { date: scheduledDate, time: scheduledTime },
          queueNumber: ctx.queue_number,
        });
      }
    } catch (err) {
      logger.error(`Reschedule email failed for appointment ${id}: ${err.message}`);
    }

    return { ...updated, queue_number: appointment.queue_number, previous };
  }

  async updateStatus(id, status) {
    const appointment = await appointmentRepository.findById(id);
    if (!appointment) {
      const error = new Error('Appointment not found');
      error.statusCode = 404;
      throw error;
    }
    const updated = await appointmentRepository.updateAppointmentStatus(id, status);

    // Confirming an appointment IS the receptionist's half of the release rule (the QR scan /
    // reference check-in at the front desk). If the booking was already paid online, this is
    // the moment the ticket reaches the modality; if it wasn't, releaseVisitIfReady reports
    // 'unpaid' and the visit correctly stays with the cashier. Reception no longer sets the
    // visit status itself — that call is the release rule's alone.
    if (status === 'Confirmed') {
      await visitService.releaseVisitIfReady(appointment.patient_visit_id);
    }

    return updated;
  }
}

module.exports = new AppointmentService();
