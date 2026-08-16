const appointmentService = require('../services/appointmentService');

class AppointmentController {
  async create(req, res, next) {
    try {
      const { patientId, scheduledDate, scheduledTime, notes, testIds, hmo } = req.body;
      const createdBy = req.user.userId;

      if (!patientId || !scheduledDate || !scheduledTime) {
        return res.status(400).json({
          status: 'error',
          message: 'Patient ID, scheduled date, and scheduled time are required.'
        });
      }

      // testIds and hmo are optional: Reception's flows and the seed script still post the
      // original body and attach tests separately. When present they are validated here so a
      // malformed value never reaches the transaction holding the slot lock.
      let normalisedTestIds = [];
      if (testIds !== undefined) {
        if (!Array.isArray(testIds)) {
          return res.status(400).json({ status: 'error', message: 'testIds must be an array.' });
        }
        normalisedTestIds = [...new Set(testIds.map(Number))];
        if (normalisedTestIds.some((id) => !Number.isInteger(id) || id <= 0)) {
          return res.status(400).json({ status: 'error', message: 'testIds must be positive whole numbers.' });
        }
        // Bounded so a hostile payload cannot hold the slot's advisory lock open.
        if (normalisedTestIds.length > 20) {
          return res.status(400).json({ status: 'error', message: 'A booking may include at most 20 tests.' });
        }
      }

      let normalisedHmo = null;
      if (hmo !== undefined && hmo !== null) {
        const providerId = Number(hmo.providerId);
        // Rejected explicitly rather than coerced: the client's "Self-Pay / None" option carries
        // the string 'none', which used to arrive here as NaN and be stored as a null provider.
        if (!Number.isInteger(providerId) || providerId <= 0) {
          return res.status(400).json({ status: 'error', message: 'Select a valid HMO provider, or choose Self-Pay.' });
        }
        if (!normalisedTestIds.length) {
          return res.status(400).json({ status: 'error', message: 'An HMO claim needs at least one test on the booking.' });
        }
        normalisedHmo = { providerId, approvalCode: hmo.approvalCode || null };
      }

      const result = await appointmentService.createAppointment({
        patientId,
        scheduledDate,
        scheduledTime,
        notes,
        createdBy,
        requestingUser: req.user,
        testIds: normalisedTestIds,
        hmo: normalisedHmo
      });

      const { appointment, visitTests, hmoRequest, alreadyBooked } = result;

      // 200 rather than 201 when the booking already existed: the request was a retry, nothing
      // new was created, and the caller gets the original reference back so it can show the real
      // confirmation instead of an error about a slot the patient themselves took.
      return res.status(alreadyBooked ? 200 : 201).json({
        status: 'success',
        message: alreadyBooked
          ? `You already have this booking. Reference: ${appointment.appointment_reference}`
          : `Appointment created. Reference: ${appointment.appointment_reference}`,
        data: { appointment, visitTests, hmoRequest, alreadyBooked }
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

  async getAll(req, res, next) {
    try {
      const { status, dateFrom, dateTo } = req.query;
      const appointments = await appointmentService.getAllAppointments({ status, dateFrom, dateTo });
      return res.status(200).json({
        status: 'success',
        data: { appointments }
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
