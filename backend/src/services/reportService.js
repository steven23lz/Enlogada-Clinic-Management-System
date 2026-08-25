const reportRepository = require('../repositories/reportRepository');
const { departmentsForUser } = require('../constants/modality');

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function assertValidRange(startDate, endDate) {
  if (!startDate || !endDate) {
    const error = new Error('startDate and endDate are both required (YYYY-MM-DD).');
    error.statusCode = 400;
    throw error;
  }
  if (!DATE_FORMAT.test(startDate) || !DATE_FORMAT.test(endDate)) {
    const error = new Error('startDate and endDate must be in YYYY-MM-DD format.');
    error.statusCode = 400;
    throw error;
  }
  if (startDate > endDate) {
    const error = new Error('startDate must not be after endDate.');
    error.statusCode = 400;
    throw error;
  }
}

class ReportService {
  async getSummaryReport(startDate, endDate) {
    assertValidRange(startDate, endDate);

    const [revenueTrend, serviceVolume, visitStatusBreakdown, paymentMethodBreakdown] = await Promise.all([
      reportRepository.getRevenueTrend(startDate, endDate),
      reportRepository.getServiceVolume(startDate, endDate),
      reportRepository.getVisitStatusBreakdown(startDate, endDate),
      reportRepository.getPaymentMethodBreakdown(startDate, endDate)
    ]);

    return { revenueTrend, serviceVolume, visitStatusBreakdown, paymentMethodBreakdown };
  }

  /**
   * HMO claim value per provider for a date range.
   *
   * Returns the providers plus a `totals` row the caller does not have to re-derive, and a
   * `note` naming the one thing a reader can get wrong: `approved` is billable to the insurer,
   * not money the clinic holds. The figure travels with its own caveat because a number this
   * shape WILL be copied into a summary, and the caveat has to survive the copy.
   */
  async getHmoClaims(startDate, endDate) {
    assertValidRange(startDate, endDate);

    const providers = await reportRepository.getHmoClaimTotals(startDate, endDate);

    const sum = (key) => providers.reduce((n, p) => n + Number(p[key] || 0), 0);
    const totals = {
      testsClaimed: providers.reduce((n, p) => n + Number(p.tests_claimed || 0), 0),
      visits: providers.reduce((n, p) => n + Number(p.visits || 0), 0),
      approved: Number(sum('approved').toFixed(2)),
      refused: Number(sum('refused').toFixed(2)),
      pending: Number(sum('pending').toFixed(2)),
      collected: Number(sum('collected').toFixed(2)),
    };

    return {
      providers,
      totals,
      note: 'Approved is billable to the insurer and is not part of counter takings.',
    };
  }

  async getStaffWorkload(startDate, endDate) {
    assertValidRange(startDate, endDate);

    const [receptionWorkload, diagnosticWorkload] = await Promise.all([
      reportRepository.getReceptionWorkload(startDate, endDate),
      reportRepository.getDiagnosticWorkload(startDate, endDate)
    ]);

    return { receptionWorkload, diagnosticWorkload };
  }

  /**
   * Per-department operating metrics, in one call. [1.22.0]
   *
   * Each role has had a KPI strip counting what is in front of it right now — the cashier's
   * collections today, the receptionist's queue length — and none of them measured how the
   * department is *performing*. There was no answer anywhere to "which service earns the most",
   * "how long does a patient wait to be billed", or "is X-Ray slower this week than last".
   *
   * One endpoint rather than three, because the Admin dashboard needs all of it at once and the
   * per-role screens each take the slice they own. Three endpoints would mean the roll-up firing
   * three requests to build one page, and three chances for the numbers on it to come from
   * different moments.
   *
   * The caller's permissions decide which slices come back. That is not cosmetic: `billing` here
   * is the day's takings, and a diagnostic account holding `results:read` but not `billing:read`
   * should not receive the clinic's revenue merely because it asked for its own turnaround
   * figures. Absent rather than zeroed — a zero would read as "no money taken today".
   */
  async getOperationsReport(startDate, endDate, requestingUser) {
    assertValidRange(startDate, endDate);

    const permissions = requestingUser?.permissions || [];
    const isSuperAdmin = (requestingUser?.roles || []).includes('SuperAdmin');
    const may = (permission) => isSuperAdmin || permissions.includes(permission);

    // Holding none of the three is a refusal, not an empty report. This route carries no
    // authorizePermissions of its own precisely because the slices are the gate — so the gate has
    // to be able to say no, or the route would be reachable by any staff account for nothing.
    if (!may('billing:read') && !may('visits:read') && !may('results:read')) {
      const error = new Error('Access forbidden. You hold no permission that this report covers.');
      error.statusCode = 403;
      throw error;
    }

    const report = { startDate, endDate };

    const work = [];
    if (may('billing:read')) {
      work.push(
        Promise.all([
          reportRepository.getBillingTotals(startDate, endDate),
          reportRepository.getSalesByService(startDate, endDate),
          reportRepository.getPaymentMethodBreakdown(startDate, endDate),
        ]).then(([totals, byService, byMethod]) => {
          report.billing = { totals, byService, byMethod };
        })
      );
    }
    if (may('visits:read')) {
      work.push(
        reportRepository.getReceptionThroughput(startDate, endDate).then((throughput) => {
          report.reception = throughput;
        })
      );
    }
    if (may('results:read')) {
      // Department-scoped for the same reason the patient roster is [1.21.0]: a lab account has
      // no business reading X-Ray's throughput. `null` from departmentsForUser means unrestricted
      // (oversight), and is deliberately not the same as an empty list.
      const departments = departmentsForUser(requestingUser);
      work.push(
        Promise.all([
          reportRepository.getDiagnosticThroughput(startDate, endDate),
          reportRepository.getOutstandingWork(),
        ]).then(([byCategory, outstanding]) => {
          const visible = (rows) =>
            departments === null ? rows : rows.filter((r) => departments.includes(r.category_name));
          report.diagnostics = {
            byCategory: visible(byCategory),
            outstanding: visible(outstanding),
            scope: departments,
          };
        })
      );
    }

    await Promise.all(work);
    return report;
  }
}

module.exports = new ReportService();
