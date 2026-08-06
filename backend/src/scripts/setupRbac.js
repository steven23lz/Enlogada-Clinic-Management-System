const db = require('../config/database');
const logger = require('../config/logger');

const setupRbac = async () => {
  try {
    logger.info('Setting up dynamic RBAC tables...');

    // 1. Create permissions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        module VARCHAR(50) NOT NULL,
        description TEXT
      );
    `);

    // 2. Create role_permissions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id SERIAL PRIMARY KEY,
        role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        CONSTRAINT uq_role_permission UNIQUE (role_id, permission_id)
      );
    `);

    // 3. Seed Permissions
    const permissionsData = [
      { name: 'appointments:create', module: 'Appointments', description: 'Create appointments & visits' },
      { name: 'appointments:read', module: 'Appointments', description: 'View appointments & visits' },
      { name: 'appointments:update', module: 'Appointments', description: 'Update appointment status' },
      { name: 'appointments:cancel', module: 'Appointments', description: 'Cancel appointments' },
      { name: 'patients:create', module: 'Patients', description: 'Register patient profiles' },
      { name: 'patients:read', module: 'Patients', description: 'View patient records' },
      { name: 'patients:update', module: 'Patients', description: 'Update patient information' },
      { name: 'billing:read', module: 'Billing', description: 'View visit billing summary' },
      { name: 'billing:process', module: 'Billing', description: 'Process payments & issue receipts' },
      { name: 'tests:manage', module: 'Tests', description: 'Manage test catalog and prices' },
      { name: 'tests:results_write', module: 'Tests', description: 'Enter diagnostic test results' },
      { name: 'rbac:manage', module: 'RBAC', description: 'Manage system roles and permissions' },
      { name: 'reports:view', module: 'Reports', description: 'View analytics and reports' }
    ];

    for (const p of permissionsData) {
      await db.query(
        `INSERT INTO permissions (name, module, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;`,
        [p.name, p.module, p.description]
      );
    }

    // 4. Map Roles to Permissions
    const rolePermissionMappings = {
      SuperAdmin: permissionsData.map(p => p.name),
      Admin: permissionsData.map(p => p.name),
      Receptionist: ['appointments:create', 'appointments:read', 'appointments:update', 'appointments:cancel', 'patients:create', 'patients:read', 'patients:update'],
      Cashier: ['billing:read', 'billing:process', 'patients:read'],
      'Laboratory Staff': ['tests:results_write', 'patients:read'],
      'Xray Staff': ['tests:results_write', 'patients:read'],
      'Ultrasound Staff': ['tests:results_write', 'patients:read'],
      Client: ['appointments:create', 'appointments:read']
    };

    // Get all roles
    const rolesRes = await db.query('SELECT id, name FROM roles');
    const roleMap = {};
    rolesRes.rows.forEach(r => { roleMap[r.name] = r.id; });

    // Get all permissions
    const permRes = await db.query('SELECT id, name FROM permissions');
    const permMap = {};
    permRes.rows.forEach(p => { permMap[p.name] = p.id; });

    for (const [roleName, permList] of Object.entries(rolePermissionMappings)) {
      const roleId = roleMap[roleName];
      if (!roleId) continue;

      for (const permName of permList) {
        const permId = permMap[permName];
        if (!permId) continue;

        await db.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING;`,
          [roleId, permId]
        );
      }
    }

    logger.info('Dynamic RBAC setup completed successfully!');
    process.exit(0);
  } catch (err) {
    logger.error('RBAC setup failed:', err);
    process.exit(1);
  }
};

setupRbac();
