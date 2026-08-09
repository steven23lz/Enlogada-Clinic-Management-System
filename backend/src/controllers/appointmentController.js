const appointmentService = require('../services/appointmentService');

class AppointmentController {
  async create(req, res, next) {
    try {
      const { patientId, scheduledDate, scheduledTime, notes } = req.body;
      const createdBy = req.user.userId;

      if (!patientId || !scheduledDate || !scheduledTime) {
        return res.status(400).json({
          status: 'error',
          message: 'Patient ID, scheduled date, and scheduled time are required.'
        });
      }

      const appointment = await appointmentService.createAppointment({
        patientId,
        scheduledDate,
        scheduledTime,
        notes,
        createdBy,
        requestingUser: req.user
      });

      return res.status(201).json({
        status: 'success',
        message: `Appointment created. Reference: ${appointment.appointment_reference}`,
        data: { appointment }
      });
    } catch (err) {
      next(err);
    }
  }

  async getAvailability(req, res, next) {
    try {
      const { date } = req.query;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          status: 'error',
          message: 'A valid date (YYYY-MM-DD) query parameter is required.'
        });
      }

      const availability = await appointmentService.getAvailableSlots(date);
      return res.status(200).json({
        status: 'success',
        data: availability
      });
    } catch (err) {
      next(err);
    }
  }

  async verifyReference(req, res, next) {
    try {
      const { reference } = req.params;
      const appointment = await appointmentService.verifyByReference(reference);

      return res.status(200).json({
        status: 'success',
        data: { appointment }
      });
    } catch (err) {
      next(err);
    }
  }

  async getMyBookings(req, res, next) {
    try {
      const userId = req.user.userId;
      const bookings = await appointmentService.getClientBookings(userId);

      return res.status(200).json({
        status: 'success',
        data: { bookings }
      });
    } catch (err) {
      next(err);
    }
  }

  async cancel(req, res, next) {
    try {
      const { id } = req.params;
      const appointment = await appointmentService.cancelAppointment(id, req.user);

      return res.status(200).json({
        status: 'success',
        message: 'Appointment cancelled successfully.',
        data: { appointment }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({
          status: 'error',
          message: 'Status is required.'
        });
      }

      const appointment = await appointmentService.updateStatus(id, status);
      return res.status(200).json({
        status: 'success',
        message: `Appointment status updated to ${status}.`,
        data: { appointment }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AppointmentController();
