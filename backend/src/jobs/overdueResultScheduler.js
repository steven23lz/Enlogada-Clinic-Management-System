const env = require('../config/environment');
const logger = require('../config/logger');
const overdueResultService = require('../services/overdueResultService');
const periodic = require('./periodic');

/** Rings the bell for a patient past the clinic's turnaround with no report. [1.163.0] Off with OVERDUE_ALERTS=off. */
module.exports = periodic({
  name: 'Overdue results check',
  enabled: env.OVERDUE_ALERTS,
  offMessage: 'The overdue results check is off (OVERDUE_ALERTS=off).',
  everyMs: 60 * 1000,
  firstAfterMs: 30 * 1000,
  run: async () => {
    const notified = await overdueResultService.sweep();
    if (notified) logger.info(`Overdue results: told the staff about ${notified} patient(s).`);
  },
});
