const env = require('../config/environment');
const logger = require('../config/logger');
const patientMessageService = require('../services/patientMessageService');
const periodic = require('./periodic');

/**
 * The server's own patient emails: results ready, a missed paid booking, "how was your visit?".
 * [1.148.0] See services/patientMessageService.js. Every five minutes is soon enough for "your
 * results are ready" and costs three small queries. Off with PATIENT_EMAILS=off.
 */
let warnedNotConfigured = false;

module.exports = periodic({
  name: 'Patient email sweep',
  enabled: env.PATIENT_EMAILS,
  offMessage: 'Patient emails are off (PATIENT_EMAILS=off).',
  everyMs: 5 * 60 * 1000,
  firstAfterMs: 30 * 1000,
  run: async () => {
    const counts = await patientMessageService.sweep(new Date());
    if (counts.notConfigured) {
      if (!warnedNotConfigured) {
        logger.warn(`Patient emails are waiting for outbound mail (${counts.notConfigured.join(', ')}).`);
        warnedNotConfigured = true;
      }
      return;
    }
    warnedNotConfigured = false;
    if (counts.sent || counts.noAddress || counts.skipped || counts.failed) {
      logger.info(
        `Patient emails: ${counts.sent} sent, ${counts.noAddress} with no address, `
        + `${counts.skipped} too late to send, ${counts.failed} failed.`
      );
    }
  },
});
