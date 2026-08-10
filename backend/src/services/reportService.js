const reportRepository = require('../repositories/reportRepository');

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
}

module.exports = new ReportService();
