const app = require('./app');
const env = require('./config/environment');
const logger = require('./config/logger');
const db = require('./config/database');

const server = app.listen(env.PORT, () => {
  logger.info(`Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
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
  server.close(() => {
    db.pool.end();
    logger.info('Process terminated.');
  });
});
