const queueCallService = require('../services/queueCallService');

class QueueController {
  async nowServing(req, res, next) {
    try {
      return res.status(200).json({ status: 'success', data: await queueCallService.nowServing() });
    } catch (err) {
      return next(err);
    }
  }

  async call(req, res, next) {
    try {
      const { visitId, station } = req.body || {};
      const call = await queueCallService.call({ visitId, station }, req.user);
      return res.status(201).json({ status: 'success', data: { call } });
    } catch (err) {
      return next(err);
    }
  }
}

module.exports = new QueueController();
