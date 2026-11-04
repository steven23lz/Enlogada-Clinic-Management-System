const cashCountService = require('../services/cashCountService');

class CashCountController {
  async status(req, res, next) {
    try {
      return res.status(200).json({ status: 'success', data: await cashCountService.status() });
    } catch (err) {
      return next(err);
    }
  }

  async day(req, res, next) {
    try {
      return res.status(200).json({ status: 'success', data: await cashCountService.day(req.query.date) });
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
