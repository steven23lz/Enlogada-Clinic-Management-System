const visitService = require('../services/visitService');
const patientService = require('../services/patientService');

class VisitController {
  async registerVisit(req, res, next) {
    try {
      const { patientId, visitType, notes } = req.body;
      const createdBy = req.user.userId;

      if (!patientId || !visitType) {
        return res.status(400).json({
          status: 'error',
          message: 'Patient ID and visit type are required.'
        });
      }

      const visit = await visitService.registerVisit({
        patientId,
        visitType,
        notes,
        createdBy
      });

      return res.status(201).json({
        status: 'success',
        message: `Visit registered. Queue number: ${visit.queue_number}`,
        data: { visit }
      });
    } catch (err) {
      next(err);
    }
  }

  async getActiveVisits(req, res, next) {
    try {
      const visits = await visitService.getActiveVisits();
      return res.status(200).json({
        status: 'success',
        data: { visits }
      });
    } catch (err) {
      next(err);
    }
  }

  async getVisitById(req, res, next) {
    try {
      const { id } = req.params;
      const visit = await visitService.getVisitById(id);
      return res.status(200).json({
        status: 'success',
        data: { visit }
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

      const visit = await visitService.updateStatus(id, status);
      return res.status(200).json({
        status: 'success',
        message: `Visit status updated to ${status}.`,
        data: { visit }
      });
    } catch (err) {
      next(err);
    }
  }

  async getVisitHistory(req, res, next) {
    try {
      const { patientId } = req.params;

      // Security Check: If client, verify patient belongs to them
      if (req.user.roles.includes('Client')) {
        const patient = await patientService.getPatientById(patientId);
        if (patient.user_id !== req.user.userId) {
          return res.status(403).json({
            status: 'error',
            message: 'Access forbidden. This patient record does not belong to your account.'
          });
        }
      }

      const visits = await visitService.getVisitHistory(patientId);
      return res.status(200).json({
        status: 'success',
        data: { visits }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new VisitController();
