const discountService = require('../services/discountService');

class DiscountController {
  async getCatalogue(req, res, next) {
    try {
      // Only SuperAdmin/Admin see deactivated entries — everyone else gets what they may grant.
      const isAdmin = req.user.roles.includes('SuperAdmin') || req.user.roles.includes('Admin');
      const discounts = await discountService.getCatalogue({
        includeInactive: isAdmin && req.query.includeInactive === 'true',
      });
      return res.status(200).json({ status: 'success', data: { discounts } });
    } catch (err) {
      next(err);
    }
  }

  async applyToVisit(req, res, next) {
    try {
      const { visitId } = req.params;
      const { discountTypeId, idNumber } = req.body;

      if (!discountTypeId) {
        return res.status(400).json({ status: 'error', message: 'A discount type is required.' });
      }

      const applied = await discountService.applyToVisit(
        visitId,
        { discountTypeId, idNumber },
        req.user
      );
      return res.status(200).json({
        status: 'success',
        message: 'Discount applied. The billing total has been recalculated.',
        data: { visit: applied },
      });
    } catch (err) {
      next(err);
    }
  }

  async clearFromVisit(req, res, next) {
    try {
      const { visitId } = req.params;
      const cleared = await discountService.clearFromVisit(visitId, req.user);
      return res.status(200).json({
        status: 'success',
        message: 'Discount removed. The billing total has been recalculated.',
        data: { visit: cleared },
      });
    } catch (err) {
      next(err);
    }
  }

  async getStatutoryRegister(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const register = await discountService.getStatutoryRegister({ startDate, endDate });
      return res.status(200).json({ status: 'success', data: { register } });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new DiscountController();
