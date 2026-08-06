const appointmentRepository = require('../repositories/appointmentRepository');
const visitRepository = require('../repositories/visitRepository');

class AppointmentService {
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
