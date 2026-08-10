const reportService = require('../services/reportService');

class ReportController {
  async getSummary(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const report = await reportService.getSummaryReport(startDate, endDate);
      return res.status(200).json({
        status: 'success',
        data: { report }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ReportController();
