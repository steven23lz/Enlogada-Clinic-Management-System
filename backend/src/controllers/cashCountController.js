const cashCountService = require('../services/cashCountService');

class CashCountController {
  async status(req, res, next) {
    try {
      return res.status(200).json({ status: 'success', data: await cashCountService.status(req.user) });
    } catch (err) {
      return next(err);
    }
  }

  // [1.162.0] One shared drawer, or one per cashier. SuperAdmin chooses, on the route.
  async getDrawers(req, res, next) {
    try {
      return res.status(200).json({ status: 'success', data: { mode: await cashCountService.drawerMode() } });
    } catch (err) {
      return next(err);
    }
  }

  async setDrawers(req, res, next) {
    try {
      return res.status(200).json({ status: 'success', data: await cashCountService.setDrawerMode(req.body?.mode, req.user) });
    } catch (err) {
      return next(err);
    }
  }

  async day(req, res, next) {
    try {
      return res.status(200).json({ status: 'success', data: await cashCountService.day(req.query.date, req.user) });
    } catch (err) {
      return next(err);
    }
  }

  async list(req, res, next) {
    try {
      const { startDate, endDate, page, limit } = req.query;
      return res.status(200).json({
        status: 'success',
        data: await cashCountService.days({ startDate, endDate, page, limit }),
      });
    } catch (err) {
      return next(err);
    }
  }

  async save(req, res, next) {
    try {
      const { date, changeFund, pieces, loose, note } = req.body || {};
      const day = await cashCountService.save({ date, changeFund, pieces, loose, note }, req.user);
      return res.status(201).json({ status: 'success', data: day });
    } catch (err) {
      return next(err);
    }
  }
}

module.exports = new CashCountController();
