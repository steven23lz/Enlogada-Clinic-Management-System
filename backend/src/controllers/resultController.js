const resultService = require('../services/resultService');
const patientService = require('../services/patientService');

class ResultController {
  async getPending(req, res, next) {
    try {
      const { category } = req.params;
      const pending = await resultService.getPendingByCategory(category, req.user);
      return res.status(200).json({
        status: 'success',
        data: { pending }
      });
    } catch (err) {
      next(err);
    }
  }

  async getReleased(req, res, next) {
    try {
      const { category } = req.params;
      const released = await resultService.getReleasedByCategory(category, req.user);
      return res.status(200).json({
        status: 'success',
        data: { released }
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

      const updated = await resultService.updateTestStatus(visitTestId, status, req.user);
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
        file: req.file,
        findings,
        remarks,
        releasedBy
      }, req.user);

      return res.status(201).json({
        status: 'success',
        message: 'Result uploaded successfully.',
        data: { result }
      });
    } catch (err) {
      next(err);
    }
  }

  async downloadResultFile(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const { absolutePath, originalName, mimeType } = await resultService.getResultFile(visitTestId, req.user);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${originalName.replace(/"/g, '')}"`);
      return res.sendFile(absolutePath);
    } catch (err) {
      next(err);
    }
  }

  async releaseResult(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const releasedBy = req.user.userId;

      const result = await resultService.releaseResult({ visitTestId, releasedBy }, req.user);
      const message = result.emailStatus === 'sent'
        ? 'Result released and patient notified via email.'
        : result.emailStatus === 'failed'
        ? 'Result released — email notification failed, patient was not notified.'
        : 'Result released. No email on file, so the patient was not notified.';

      return res.status(200).json({
        status: 'success',
        message,
        data: { result }
      });
    } catch (err) {
      next(err);
    }
  }

  async getResult(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const result = await resultService.getResultByVisitTestId(visitTestId, req.user);
      return res.status(200).json({
        status: 'success',
        data: { result: result || null }
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

      // requestingUser drives the department scoping in the service — a diagnostic role sees only
      // its own categories here, matching every other result route.
      const results = await resultService.getPatientHistory(patientId, req.user);
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
