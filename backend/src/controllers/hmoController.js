const hmoService = require('../services/hmoService');
const { discardHmoCard } = require('../config/upload');

class HmoController {
  async createRequest(req, res, next) {
    try {
      const { hmoProviderId, approvalCode, visitTestIds } = req.body;

      // Multipart sends visitTestIds[] as strings; JSON callers still send numbers.
      let ids = visitTestIds;
      if (typeof ids === 'string') ids = [ids];

      if (!hmoProviderId || !ids || !Array.isArray(ids) || ids.length === 0) {
        discardHmoCard(req.file);
        return res.status(400).json({
          status: 'error',
          message: 'HMO provider ID and an array of visit test IDs are required.'
        });
      }

      const request = await hmoService.createRequest(
        {
          hmoProviderId: Number(hmoProviderId),
          approvalCode,
          visitTestIds: ids.map(Number),
          cardFile: req.file || null,
          // Optional in the body: the visit may already name a physician, in which case nothing
          // needs supplying. hmoService decides, and records this only when the visit has none.
          referral: {
            referringPhysician: req.body.referringPhysician,
            referringPhysicianPrc: req.body.referringPhysicianPrc,
          },
        },
        req.user
      );
      return res.status(201).json({
        status: 'success',
        message: 'HMO request logged successfully.',
        data: { request }
      });
    } catch (err) {
      // The standalone route has no transaction to roll back, so a rejected claim must drop its
      // own upload here.
      discardHmoCard(req.file);
      next(err);
    }
  }

  async downloadCard(req, res, next) {
    try {
      const { absolutePath, originalName, mimeType } = await hmoService.getCardFile(
        Number(req.params.id),
        req.user
      );
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${originalName.replace(/"/g, '')}"`);
      return res.sendFile(absolutePath);
    } catch (err) {
      next(err);
    }
  }

  async approveRequest(req, res, next) {
    try {
      const { id } = req.params;
      const { approvalCode } = req.body;

      if (!approvalCode) {
        return res.status(400).json({
          status: 'error',
          message: 'Approval code is required.'
        });
      }

      const request = await hmoService.approveRequest(id, { approvalCode }, req.user);
      return res.status(200).json({
        status: 'success',
        message: 'HMO request approved.',
        data: { request }
      });
    } catch (err) {
      next(err);
    }
  }

  async getRequestDetails(req, res, next) {
    try {
      const { id } = req.params;
      const request = await hmoService.getRequestDetails(id);
      return res.status(200).json({
        status: 'success',
        data: { request }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateTestApproval(req, res, next) {
    try {
      const { hmoRequestTestId } = req.params;
      const { approvalStatus } = req.body;

      if (!approvalStatus) {
        return res.status(400).json({
          status: 'error',
          message: 'Approval status is required.'
        });
      }

      const updated = await hmoService.updateTestApproval(hmoRequestTestId, approvalStatus, req.user);
      return res.status(200).json({
        status: 'success',
        message: `Test approval status updated to ${approvalStatus}.`,
        data: { hmoRequestTest: updated }
      });
    } catch (err) {
      next(err);
    }
  }

  async getAllRequests(req, res, next) {
    try {
      const { status } = req.query;
      const requests = await hmoService.getAllRequests({ status });
      return res.status(200).json({
        status: 'success',
        data: { requests }
      });
    } catch (err) {
      next(err);
    }
  }

  async getProviders(req, res, next) {
    try {
      const providers = await hmoService.getProviders();
      return res.status(200).json({
        status: 'success',
        data: { providers }
      });
    } catch (err) {
      next(err);
    }
  }

  async createProvider(req, res, next) {
    try {
      const { name } = req.body;
      const provider = await hmoService.createProvider(name, req.user);
      return res.status(201).json({
        status: 'success',
        message: 'HMO provider added.',
        data: { provider }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateProvider(req, res, next) {
    try {
      const { id } = req.params;
      const { name, isActive } = req.body;
      const provider = await hmoService.updateProvider(id, { name, isActive }, req.user);
      return res.status(200).json({
        status: 'success',
        message: 'HMO provider updated.',
        data: { provider }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new HmoController();
