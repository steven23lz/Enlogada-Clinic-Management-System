const logger = require('../config/logger');

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  logger.error(err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message: req.app.get('env') === 'development' ? message : (statusCode === 500 ? 'Something went wrong' : message),
    ...(req.app.get('env') === 'development' && { stack: err.stack })
  });
};
