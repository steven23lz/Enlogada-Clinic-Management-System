const env = require('../config/environment');
const backupService = require('../services/backupService');
const periodic = require('./periodic');

/**
 * The nightly backup, from inside the server. [1.148.0] Looks every five minutes whether one is
 * due (utils/backupPlan.js: after 18:00, or at once when the newest is a day old); the backup
 * itself is services/backupService.js. Off with BACKUPS=off.
 */
module.exports = periodic({
  name: 'Backup',
  enabled: env.BACKUPS,
  offMessage: env.BACKUPS_BY_HOST
    ? 'Backups: left to the hosting company (BACKUPS=host).'
    : 'Backups are off (BACKUPS=off).',
  everyMs: 5 * 60 * 1000,
  firstAfterMs: 60 * 1000,
  run: () => backupService.runIfDue(new Date()),
  startMessage: `Backups: automatic, daily after ${env.BACKUP_AT}, into ${backupService.folder()}.`,
});
