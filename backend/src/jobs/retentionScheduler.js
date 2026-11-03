const env = require('../config/environment');
const logger = require('../config/logger');
const retentionService = require('../services/retentionService');
const periodic = require('./periodic');

/**
 * The daily retention pass, from inside the server. [1.148.0] Old notifications, Activity Log
 * entries past their window and HMO card photos past a year (services/retentionService.js), which
 * three scripts did only when somebody ran them. Idempotent, so running it again after a restart
 * deletes nothing twice. Off with RETENTION=off.
 */
module.exports = periodic({
  name: 'Retention pass',
  enabled: env.RETENTION,
  offMessage: 'The retention pass is off (RETENTION=off).',
  everyMs: 24 * 60 * 60 * 1000,
  firstAfterMs: 2 * 60 * 1000,
  run: async () => {
    const { notifications, auditRows, hmoCards } = await retentionService.runAll();
    const notes = notifications.readRows + notifications.staleRows;
    if (notes || auditRows || hmoCards) {
      logger.info(`Retention: removed ${notes} notification row(s), ${auditRows} Activity Log entr(ies), ${hmoCards} HMO card photo(s).`);
    }
  },
});
