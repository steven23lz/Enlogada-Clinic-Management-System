const appointmentRepository = require('../repositories/appointmentRepository');
const visitRepository = require('../repositories/visitRepository');
const scheduleRepository = require('../repositories/scheduleRepository');

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

  async createAppointment({ patientId, scheduledDate, scheduledTime, notes, createdBy }) {
    // 1. Create a patient_visit record first (visit_type = 'Appointment')
    const queueNumber = await visitRepository.getNextQueueNumber();
    const visit = await visitRepository.createVisit({
      patientId,
      visitType: 'Appointment',
      notes,
      queueNumber,
      createdBy
    });

    // 2. Create the appointment record linked to the visit
    const appointment = await appointmentRepository.createAppointment({
      patientVisitId: visit.id,
      scheduledDate,
      scheduledTime,
      notes
    });

    return {
      ...appointment,
      queue_number: visit.queue_number
    };
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

  async cancelAppointment(id, userId) {
    const appointment = await appointmentRepository.findById(id);
    if (!appointment) {
      const error = new Error('Appointment not found');
      error.statusCode = 404;
      throw error;
    }

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
