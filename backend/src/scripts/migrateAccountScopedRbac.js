/**
 * [1.20.0] Per-account permission overrides and department assignment.
 *
 * migrateDb.js drops and recreates everything, so it cannot be used on a live database. This
 * adds the same two tables additively and is safe to re-run.
 *
 * WHY THIS EXISTS
 * ---------------
 * The role-permission matrix was the only way to say who may do what, which meant every
 * exception had to be expressed as a role. That is fine until the first real one arrives: the
 * receptionist who also covers the till on Saturdays, or the lab tech who must not be able to
 * issue refunds. Editing the Cashier role to suit one person changes it for every cashier;
 * inventing "Receptionist (Weekend)" multiplies roles until nobody can read the matrix.
 *
 * user_permissions holds the exceptions, in both directions — a grant-only table cannot express
 * "everything a Cashier gets, except refunds", which is the more common request and the one with
 * money attached.
 *
 * user_departments is a separate axis on purpose. A permission answers "may you write a result?"
 * A department answers "whose?" Before this, any diagnostic account could search any patient's
 * records regardless of which room they work in.
 *
 *   node src/scripts/migrateAccountScopedRbac.js
 */
const db = require('../config/database');
const logger = require('../config/logger');

const STATEMENTS = [
  [
    'user_permissions table',
    `CREATE TABLE IF NOT EXISTS user_permissions (
       id SERIAL PRIMARY KEY,
       user_id INT NOT NULL,
       permission_id INT NOT NULL,
       effect VARCHAR(10) NOT NULL,
       granted_by INT,
       reason TEXT,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT fk_user_permissions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
       CONSTRAINT fk_user_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
       CONSTRAINT fk_user_permissions_granted_by FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
       CONSTRAINT chk_user_permissions_effect CHECK (effect IN ('grant', 'revoke')),
       CONSTRAINT uq_user_permission UNIQUE (user_id, permission_id)
     )`,
  ],
  [
    'user_permissions lookup index',
    'CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id)',
  ],
  [
    'user_departments table',
    `CREATE TABLE IF NOT EXISTS user_departments (
       id SERIAL PRIMARY KEY,
       user_id INT NOT NULL,
       category_id INT NOT NULL,
       granted_by INT,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT fk_user_departments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
       CONSTRAINT fk_user_departments_category FOREIGN KEY (category_id) REFERENCES test_categories(id) ON DELETE CASCADE,
       CONSTRAINT fk_user_departments_granted_by FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
       CONSTRAINT uq_user_department UNIQUE (user_id, category_id)
     )`,
  ],
  [
    'user_departments lookup index',
    'CREATE INDEX IF NOT EXISTS idx_user_departments_user ON user_departments(user_id)',
  ],
];

async function migrate() {
  logger.info('[1.20.0] Adding per-account permission overrides and department assignment…');

  for (const [label, sql] of STATEMENTS) {
    await db.query(sql);
    logger.info(`  ✓ ${label}`);
  }

  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM user_permissions) AS overrides,
      (SELECT COUNT(*) FROM user_departments) AS departments
  `);
  logger.info(`  existing overrides: ${rows[0].overrides} permission, ${rows[0].departments} department`);
  logger.info('[1.20.0] Done. Role templates are unchanged; every account keeps exactly the access it had.');
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('[1.20.0] Migration failed:', err);
    process.exit(1);
  });
