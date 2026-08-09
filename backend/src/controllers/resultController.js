const resultService = require('../services/resultService');
const patientService = require('../services/patientService');

class ResultController {
  async getPending(req, res, next) {
    try {
      const { category } = req.params;
      const pending = await resultService.getPendingByCategory(category);
      return res.status(200).json({
        status: 'success',
        data: { pending }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateTestStatus(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({
          status: 'error',
          message: 'Status is required.'
        });
      }

      const updated = await resultService.updateTestStatus(visitTestId, status);
      return res.status(200).json({
        status: 'success',
        message: `Test status updated to ${status}.`,
        data: { visitTest: updated }
      });
    } catch (err) {
      next(err);
    }
  }

  async uploadResult(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const { fileUrl, findings, remarks } = req.body;
      const releasedBy = req.user.userId;

      const result = await resultService.uploadResult({
        visitTestId,
        fileUrl,
        findings,
        remarks,
        releasedBy
      });

      return res.status(201).json({
        status: 'success',
        message: 'Result uploaded successfully.',
        data: { result }
      });
    } catch (err) {
      next(err);
    }
  }

  async releaseResult(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const releasedBy = req.user.userId;

      const result = await resultService.releaseResult({ visitTestId, releasedBy });
      return res.status(200).json({
        status: 'success',
        message: 'Result released and patient notified via email.',
        data: { result }
      });
    } catch (err) {
      next(err);
    }
  }

  async getPatientHistory(req, res, next) {
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

      const results = await resultService.getPatientHistory(patientId);
      return res.status(200).json({
        status: 'success',
        data: { results }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ResultController();
