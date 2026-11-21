// [1.173.0] The server is in production unless it is told otherwise. Express, and every limit in
// app.js, read an unset NODE_ENV as development: a deployment that forgot the one setting would
// have allowed 2,000 wrong passwords a window instead of 10, shown stack traces and internal error
// messages to the public, and lifted the invitation caps. `npm run dev` says development
// (nodemon.json). Set before anything is required, because express() reads it when the app is made.
// Only the server: the scripts that delete data refuse an explicit 'production' and run unset.
require('dotenv').config(); // .env first: a NODE_ENV written there is honoured, not overridden
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

const app = require('./app');
const env = require('./config/environment');
const logger = require('./config/logger');
const db = require('./config/database');

const { reportPendingRepairs, reportGatewayConfiguration, reportAccountMail, reportHosting } = require('./config/startupAdvisory');
const reminderScheduler = require('./jobs/reminderScheduler');
const unpaidExpiryScheduler = require('./jobs/unpaidExpiryScheduler');
const patientMessageScheduler = require('./jobs/patientMessageScheduler');
const retentionScheduler = require('./jobs/retentionScheduler');
const overdueResultScheduler = require('./jobs/overdueResultScheduler');
const backupScheduler = require('./jobs/backupScheduler');

const server = app.listen(env.PORT, () => {
  logger.info(`Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
  // After listen, and deliberately not awaited: an advisory about historical data must never
  // delay the port opening or fail the boot. It reports and returns; it repairs nothing. [1.32.0]
  reportPendingRepairs();
  reportGatewayConfiguration();
  reportAccountMail();
  reportHosting();
  // [1.130.0] Appointment reminders, sent by the server itself.
  reminderScheduler.start();
  // [1.131.0] Unpaid walk-ins and bookings whose time is up are removed.
  unpaidExpiryScheduler.start();
  // [1.148.0] Results ready / missed booking / feedback emails, the retention pass, the nightly backup.
  patientMessageScheduler.start();
  retentionScheduler.start();
  overdueResultScheduler.start();
  backupScheduler.start();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection! Shutting down server...', err);
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception! Shutting down server...', err);
  process.exit(1);
});

// Handle system shutdown signals (graceful close)
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  reminderScheduler.stop();
  unpaidExpiryScheduler.stop();
  patientMessageScheduler.stop();
  retentionScheduler.stop();
  overdueResultScheduler.stop();
  backupScheduler.stop();
  server.close(() => {
    db.pool.end();
    logger.info('Process terminated.');
  });
});
