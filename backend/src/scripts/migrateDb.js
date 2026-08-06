const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../config/logger');

const runMigration = async () => {
  try {
    const schemaPath = path.join(__dirname, '../../../database/schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    logger.info('Running database migration using schema.sql...');
    await db.query(sql);
    logger.info('Database migration completed successfully! All tables recreated.');
    process.exit(0);
  } catch (err) {
    logger.error('Database migration failed:', err);
    process.exit(1);
  }
};

runMigration();
