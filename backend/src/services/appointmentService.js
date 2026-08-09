const db = require('../config/database');
const appointmentRepository = require('../repositories/appointmentRepository');
const visitRepository = require('../repositories/visitRepository');
const scheduleRepository = require('../repositories/scheduleRepository');
const patientService = require('./patientService');

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

  async createAppointment({ patientId, scheduledDate, scheduledTime, notes, createdBy, requestingUser }) {
    await assertClientOwnsPatient(requestingUser, patientId);

    const client = await db.pool.connect();
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
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${scheduledDate}|${scheduledTime}`]);

      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM appointments WHERE scheduled_date = $1 AND scheduled_time = $2 AND status <> 'Cancelled'`,
        [scheduledDate, scheduledTime]
      );
      if (rows[0].cnt >= hours.max_concurrent_bookings) {
        const error = new Error('This time slot is no longer available. Please select a different time.');
        error.statusCode = 409;
        throw error;
      }

      // 3. Create the patient_visit record first (visit_type = 'Appointment')
      const queueNumber = await visitRepository.getNextQueueNumber(client);
      const visit = await visitRepository.createVisit({
        patientId,
        visitType: 'Appointment',
        notes,
        queueNumber,
        createdBy
      }, client);

      // 4. Create the appointment record linked to the visit
      const appointment = await appointmentRepository.createAppointment({
        patientVisitId: visit.id,
        scheduledDate,
        scheduledTime,
        notes
      }, client);

      await client.query('COMMIT');

      return {
        ...appointment,
        queue_number: visit.queue_number
      };
    } catch (err) {
      await client.query('ROLLBACK');
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
    return await appointmentRepository.updateAppointmentStatus(id, status);
  }
}

module.exports = new AppointmentService();
