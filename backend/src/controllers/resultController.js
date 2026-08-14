const fs = require('fs');
const resultService = require('../services/resultService');
const patientService = require('../services/patientService');
const logger = require('../config/logger');

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
      // days/limit/offset are optional; the service clamps them. Defaults to the last 90 days,
      // which is what the screen actually shows — this list used to return every completed test
      // in the clinic's history, findings text included, on every load.
      const { days, limit, offset } = req.query;
      const released = await resultService.getReleasedByCategory(category, req.user, {
        days,
        limit,
        offset
      });
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
      const { fileUrl, findings, remarks, amendmentReason, isCritical } = req.body;
      const releasedBy = req.user.userId;

      const result = await resultService.uploadResult({
        visitTestId,
        fileUrl,
        file: req.file,
        findings,
        remarks,
        releasedBy,
        amendmentReason,
        // Arrives as a string over multipart/form-data, where every field is text — a bare
        // truthiness check would make the string "false" mean true.
        isCritical: isCritical === true || isCritical === 'true'
      }, req.user);

      return res.status(201).json({
        status: 'success',
        message: 'Result uploaded successfully.',
        data: { result }
      });
    } catch (err) {
      // multer runs as route middleware, so by the time this handler executes the file is
      // already on disk — including for requests that are about to be refused. Without this,
      // every rejected upload (wrong department, ticket not released yet, a validation failure,
      // a rolled-back transaction) left a PHI-bearing file on the clinic's disk with no database
      // row pointing at it and nothing that would ever delete it. Unlinking here keeps that set
      // empty rather than letting it grow with every mis-click.
      if (req.file?.path) {
        fs.unlink(req.file.path, (unlinkErr) => {
          if (unlinkErr) {
            // Reported, never thrown: failing to tidy up must not replace the real error the
            // caller needs to see.
            logger.warn(`Could not remove orphaned upload ${req.file.path}: ${unlinkErr.message}`);
          }
        });
      }
      next(err);
    }
  }

  async getVersionHistory(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const versions = await resultService.getVersionHistory(visitTestId, req.user);
      return res.status(200).json({ status: 'success', data: { versions } });
    } catch (err) {
      next(err);
    }
  }

  async acknowledgeCritical(req, res, next) {
    try {
      const { visitTestId } = req.params;
      const { note } = req.body;
      const result = await resultService.acknowledgeCritical(visitTestId, { note }, req.user);
      return res.status(200).json({
        status: 'success',
        message: 'Critical result acknowledged. The callback has been recorded.',
        data: { result },
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
