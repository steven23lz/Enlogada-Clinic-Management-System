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

  /**
   * GET /reports/operations — per-department operating metrics for a date range.
   *
   * Gated on `reports:view` like its siblings, but the SLICES it returns are decided inside the
   * service by the caller's own permissions: a diagnostic account gets its turnaround figures and
   * no revenue. Passing req.user rather than filtering here keeps that decision next to the
   * queries it governs.
   */
  async getOperations(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const report = await reportService.getOperationsReport(startDate, endDate, req.user);
      return res.status(200).json({ status: 'success', data: { report } });
    } catch (err) {
      next(err);
    }
  }

  async getStaffWorkload(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const workload = await reportService.getStaffWorkload(startDate, endDate);
      return res.status(200).json({
        status: 'success',
        data: { workload }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ReportController();
