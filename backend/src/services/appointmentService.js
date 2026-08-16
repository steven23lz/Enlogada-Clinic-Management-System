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

function minutesToTime(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function todayLocalDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
    testIds = [], hmo = null, hmoCardFile = null
  }) {
    await assertClientOwnsPatient(requestingUser, patientId);

    const client = await db.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');

      // 1. Validate the requested slot against clinic operating hours
      const dayOfWeek = new Date(`${scheduledDate}T12:00:00Z`).getUTCDay();
      const hours = await scheduleRepository.findOperatingHoursForDay(dayOfWeek, client);

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

      // 2. Serialize concurrent bookings for the same slot (no row exists yet to lock
      //    on an empty slot, so an advisory lock closes that race window).
      //    Everything from here to COMMIT runs while other bookings for this slot wait, so keep
      //    it short -- in particular, never put a file write or a network call in here.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${scheduledDate}|${scheduledTime}`]);

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
        { patientId, scheduledDate, scheduledTime }, client
      );
      if (existing) {
        const visitTests = testIds.length
          ? await testService.attachTests(existing.patient_visit_id, testIds, client)
          : await testRepository.findTestsByVisitId(existing.patient_visit_id, client);

        await client.query('COMMIT');
        committed = true;

        // A retry re-sends the card the original booking already carries, and this path files no
        // new claim for it to attach to. Drop the bytes rather than letting a re-submission swap
        // the evidence under a claim an Admin may already have reviewed.
        discardHmoCard(hmoCardFile);

        // No notification: staff were already told about this booking when it was made.
        return { appointment: existing, visitTests, hmoRequest: null, alreadyBooked: true };
      }

      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM appointments WHERE scheduled_date = $1 AND scheduled_time = $2 AND status <> 'Cancelled'`,
        [scheduledDate, scheduledTime]
      );
      if (rows[0].cnt >= hours.max_concurrent_bookings) {
        const error = new Error('This time slot is no longer available. Please select a different time.');
        error.statusCode = 409;
        throw error;
      }

      // 4. Create the patient_visit record first (visit_type = 'Appointment')
      const queueNumber = await visitRepository.getNextQueueNumber(client);
      const visit = await visitRepository.createVisit({
        patientId,
        visitType: 'Appointment',
        notes,
        queueNumber,
        createdBy
      }, client);

      // 5. Create the appointment record linked to the visit
      const appointment = await appointmentRepository.createAppointment({
        patientVisitId: visit.id,
        scheduledDate,
        scheduledTime,
        notes
      }, client);

      // 6. Attach the chosen tests, and the HMO claim if one was made. Order matters:
      //    hmo_request_tests references visit_tests.
      const visitTests = testIds.length
        ? await testService.attachTests(visit.id, testIds, client)
        : [];

      let hmoRequest = null;
      if (hmo && visitTests.length) {
        hmoRequest = await hmoService.createRequest({
          hmoProviderId: hmo.providerId,
          approvalCode: hmo.approvalCode || null,
          visitTestIds: visitTests.map((vt) => vt.id),
          cardFile: hmoCardFile
        }, requestingUser, client);
      }

      await client.query('COMMIT');
      committed = true;

      // Module 18 (Notification): Receptionist owns intake/check-in for a booked appointment;
      // Admin/SuperAdmin have standing oversight (matches the existing Appointments Oversight
      // page). Fired after COMMIT so a notification failure can never roll back a real booking —
      // which is why `committed` gates the ROLLBACK below. Before that flag existed this sat
      // inside the try, so a throw here would have issued ROLLBACK on an already-committed
      // transaction and reported a real booking as failed.
      await notificationService.notifyRoles(['Receptionist', 'Admin', 'SuperAdmin'], {
        title: 'New Appointment Booked',
        message: `Queue #${visit.queue_number} — ${scheduledDate} at ${scheduledTime}`,
        type: 'info'
      });

      return {
        appointment: { ...appointment, queue_number: visit.queue_number },
        visitTests,
        hmoRequest,
        alreadyBooked: false
      };
    } catch (err) {
      if (!committed) {
        // Guarded: a ROLLBACK that itself throws (dead connection) would otherwise replace the
        // real error with a less useful one.
        try {
          await client.query('ROLLBACK');
        } catch { /* the original error is the one worth reporting */ }

        // Nothing committed references the card, so the bytes multer wrote are unreachable.
        // Gated on `committed` for the same reason the ROLLBACK is: after a successful commit
        // there IS a row pointing at this file, and deleting it would break a real booking —
        // which is exactly what would happen if the post-commit notifyRoles call ever threw.
        discardHmoCard(hmoCardFile);
      }
      throw err;
    } finally {
      client.release();
    }
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

    // Update appointment status to Cancelled
    const updated = await appointmentRepository.updateAppointmentStatus(id, 'Cancelled');

    // Also cancel the linked visit
    await visitRepository.updateVisitStatus(appointment.patient_visit_id, 'Cancelled');

    return updated;
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
