const reportService = require('../services/reportService');
const { wantsCsv, csvFilename, sendCsv } = require('../utils/csvExport');
const reportCsv = require('../utils/reportCsv');

/**
 * `?format=csv` on any report returns the same figures as a file. [1.62.0]
 *
 * The reports were readable and not extractable — the only way to get a number off the screen was
 * to retype it or print the page, and a printed page cannot be reconciled against a drawer.
 *
 * Three properties this deliberately has:
 *
 *   - The JSON path is UNTOUCHED. `wantsCsv` is false for a missing parameter, for an empty one,
 *     and for any value that is not "csv", so every existing caller — the dashboards, the E2E
 *     specs, anything the clinic has bookmarked — gets byte-identical responses.
 *   - The SERVICE runs first, unchanged, and the format decision happens after it returns. So a
 *     CSV export cannot see figures a JSON request could not: the operations report's per-slice
 *     permission checks and the 403 for a caller holding none of them apply exactly as before,
 *     because they happen inside the call both formats make.
 *   - Validation still comes from the service. A bad date range throws its 400 before any header
 *     is written, which is the order that matters — `sendCsv` sets Content-Disposition, and a
 *     response that has begun as a file download cannot then become an error page.
 */
class ReportController {
  async getSummary(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const report = await reportService.getSummaryReport(startDate, endDate);

      if (wantsCsv(req)) {
        return sendCsv(
          res,
          csvFilename('clinic-summary', startDate, endDate),
          reportCsv.summaryCsv(report, startDate, endDate)
        );
      }

      return res.status(200).json({
        status: 'success',
        data: { report }
      });
    } catch (err) {
      next(err);
    }
  }

  async getHmoClaims(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const report = await reportService.getHmoClaims(startDate, endDate);

      if (wantsCsv(req)) {
        return sendCsv(
          res,
          csvFilename('hmo-claims', startDate, endDate),
          reportCsv.hmoClaimsCsv(report, startDate, endDate)
        );
      }

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

      if (wantsCsv(req)) {
        return sendCsv(
          res,
          csvFilename('operations', startDate, endDate),
          reportCsv.operationsCsv(report, startDate, endDate)
        );
      }

      return res.status(200).json({ status: 'success', data: { report } });
    } catch (err) {
      next(err);
    }
  }

  async getStaffWorkload(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const workload = await reportService.getStaffWorkload(startDate, endDate);

      if (wantsCsv(req)) {
        return sendCsv(
          res,
          csvFilename('staff-workload', startDate, endDate),
          reportCsv.staffWorkloadCsv(workload, startDate, endDate)
        );
      }

      return res.status(200).json({
        status: 'success',
        data: { workload }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /reports/analytics — the two aggregations the BI dashboard added. [1.62.0]
   *
   * Turnaround against a target, and arrivals by hour of day. Separate from /operations rather
   * than folded into it because the two answer different questions and are read on different
   * screens: operations is "how did the departments perform", this is "where is the clinic's
   * capacity going". Folding them in would also mean every existing caller of /operations
   * silently paying for two more aggregate queries it does not render.
   */
  async getAnalytics(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const report = await reportService.getAnalytics(startDate, endDate, req.user);

      if (wantsCsv(req)) {
        return sendCsv(
          res,
          csvFilename('clinic-analytics', startDate, endDate),
          reportCsv.analyticsCsv(report, startDate, endDate)
        );
      }

      return res.status(200).json({ status: 'success', data: { report } });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ReportController();
