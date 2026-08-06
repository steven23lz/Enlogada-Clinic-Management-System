const { Pool } = require('pg');
const env = require('./environment');
const logger = require('./logger');

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    logger.error('Database connection failed:', err);
  } else {
    logger.info('Database connected successfully at ' + res.rows[0].now);
  }
});

module.exports = {
  query: (text, params) => {
    logger.debug(`Executing query: ${text}`);
    return pool.query(text, params);
  },
  pool
};
