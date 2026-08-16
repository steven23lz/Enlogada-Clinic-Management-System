const db = require('../config/database');
const logger = require('../config/logger');

/**
 * Seeds the permission catalogue and the default role → permission matrix.
 *
 * The taxonomy deliberately covers the whole route surface, not a sample of it. The previous set
 * had 13 permissions against 84 routes, so most of what the app actually does — creating a visit,
 * attaching tests, releasing a result, granting a discount, approving an HMO request, managing
 * staff — had no permission that could express it. A matrix that cannot describe an action cannot
 * govern it, which is the main reason the old one had to be labelled "advisory only".
 *
 * Naming is `module:verb`, and the module prefix is what the matrix screen groups by, so keep it
 * meaningful. Read/write/administer are separated wherever a role legitimately needs one without
 * the others — that separation is the whole point of delegating.
 *
 * The default matrix below reproduces exactly what each role could already do before permissions
 * were enforced. That is deliberate: turning enforcement on should change nothing on day one, so
 * that any behaviour change afterwards is one somebody chose in the UI rather than a side effect
 * of this script.
 *
 * Safe to re-run. It adds and updates; it never revokes, so a permission a SuperAdmin has
 * deliberately unticked in the matrix is not silently handed back on the next deploy.
 *   node src/scripts/setupRbac.js
 */
const PERMISSIONS = [
  // Patients
  { name: 'patients:create', module: 'Patients', description: 'Register new patient profiles' },
  { name: 'patients:read', module: 'Patients', description: 'View patient records and demographics' },
  // [1.21.0] The department escape hatch, expressed as a permission so a SuperAdmin can grant it
  // rather than it being a hardcoded exemption for Admin.
  //
  // Without it, a search is filtered to patients who have had work in the searcher's own
  // department: a Laboratory account finds patients with lab tests, and nobody else. That is the
  // correct default for a diagnostic role — a lab tech has no clinical reason to pull up an
  // unrelated patient's X-ray history — and it is precisely the containment the roster search
  // previously had none of.
  //
  // Front-office roles hold it because their job IS clinic-wide: Reception registers everyone
  // before any department exists on the record, and the Cashier bills for whatever is on the
  // visit. Scoping them by department would leave them able to find nobody, since neither role
  // implies a modality.
  { name: 'patients:read_all_departments', module: 'Patients', description: 'Search and open patient records outside your own department' },
  { name: 'patients:update', module: 'Patients', description: 'Correct patient information' },

  // Visits / queue
  { name: 'visits:create', module: 'Visits', description: 'Register a walk-in and issue a queue ticket' },
  { name: 'visits:read', module: 'Visits', description: 'View the active queue and visit history' },
  { name: 'visits:update', module: 'Visits', description: 'Change a visit status, cancel a visit' },

  // Appointments
  { name: 'appointments:create', module: 'Appointments', description: 'Book an appointment' },
  { name: 'appointments:read', module: 'Appointments', description: 'View appointments' },
  { name: 'appointments:update', module: 'Appointments', description: 'Check in, mark no-show' },
  { name: 'appointments:cancel', module: 'Appointments', description: 'Cancel an appointment' },

  // Test catalogue and assignment
  { name: 'tests:manage', module: 'Tests', description: 'Manage the service catalogue and prices' },
  { name: 'tests:assign', module: 'Tests', description: 'Attach tests to a visit' },
  { name: 'tests:read_assigned', module: 'Tests', description: 'See which tests are attached to a visit' },

  // Diagnostic results — read, author and authorise are three different things
  { name: 'results:read', module: 'Results', description: 'View worklists and released results' },
  { name: 'results:write', module: 'Results', description: 'Record diagnostic findings' },
  { name: 'results:release', module: 'Results', description: 'Authorise release of a result to the patient' },
  { name: 'results:acknowledge_critical', module: 'Results', description: 'Record a critical-result callback' },

  // Billing
  { name: 'billing:read', module: 'Billing', description: 'View bills and transaction history' },
  { name: 'billing:process', module: 'Billing', description: 'Take payment and issue a receipt' },
  { name: 'billing:refund', module: 'Billing', description: 'Refund or void a settled payment' },
  { name: 'billing:discount', module: 'Billing', description: 'Grant a statutory or commercial discount' },

  // HMO
  { name: 'hmo:read', module: 'HMO', description: 'View HMO requests and providers' },
  { name: 'hmo:request', module: 'HMO', description: 'Log an HMO pre-authorisation' },
  { name: 'hmo:approve', module: 'HMO', description: 'Approve HMO coverage for a test' },

  // Oversight
  { name: 'reports:view', module: 'Reports', description: 'View clinic reports and analytics' },
  { name: 'audit:view', module: 'Reports', description: 'View the activity and audit log' },
  { name: 'staff:manage', module: 'Administration', description: 'Create and manage operational staff accounts' },
  { name: 'rbac:manage', module: 'Administration', description: 'Edit the role-permission matrix' },
];

// Reproduces exactly what each role could already do. See the note above on why.
const RECEPTION = [
  'patients:create', 'patients:read', 'patients:update',
  'visits:create', 'visits:read', 'visits:update',
  'appointments:read', 'appointments:update', 'appointments:cancel',
  'tests:assign', 'tests:read_assigned', 'hmo:read', 'hmo:request',
  'results:acknowledge_critical',
  // Reception applies the statutory (Senior Citizen / PWD) discount at the desk, when the ID is
  // presented. POST /discounts/visit/:visitId has always allowed the Receptionist role, but the
  // matrix never granted the permission — and nothing caught the disagreement because that route
  // carried no permission gate at all, so the role list alone decided. Now that it is gated,
  // stating the grant keeps behaviour byte-identical and makes it visible and revocable.
  'billing:discount',
  // Front office is clinic-wide by function, not departmental — see the note on the permission.
  'patients:read_all_departments',
];

const CASHIER = [
  'patients:read', 'patients:read_all_departments', 'visits:read', 'visits:update',
  'billing:read', 'billing:process', 'billing:refund', 'billing:discount',
  'hmo:read',
];

const MODALITY = [
  'results:read', 'results:write', 'results:release', 'results:acknowledge_critical',
  'patients:read', 'tests:read_assigned',
];

// Admin is oversight: it reads everything and writes almost nothing clinical or financial.
//
// The two exclusions are deliberate and long-standing. Admin cannot take a payment (the reviewer
// of the cash-up must not also be the transactor) and cannot author or release a clinical result
// (a test_result names the clinician who produced it). rbac:manage is excluded too — deciding who
// may do what is the one thing that separates SuperAdmin from a very capable Admin.
const ADMIN = [
  'patients:create', 'patients:read', 'patients:read_all_departments', 'patients:update',
  'visits:create', 'visits:read', 'visits:update',
  'appointments:read', 'appointments:update', 'appointments:cancel',
  'tests:manage', 'tests:assign', 'tests:read_assigned',
  'results:read', 'results:acknowledge_critical',
  'billing:read', 'billing:refund', 'billing:discount',
  'hmo:read', 'hmo:request', 'hmo:approve',
  'reports:view', 'audit:view', 'staff:manage',
];

const ROLE_PERMISSIONS = {
  SuperAdmin: PERMISSIONS.map((p) => p.name),
  Admin: ADMIN,
  Receptionist: RECEPTION,
  Cashier: CASHIER,
  'Laboratory Staff': MODALITY,
  'Xray Staff': MODALITY,
  'Ultrasound Staff': MODALITY,
  // A Client's grants look broad but are not: every one of these is additionally ownership-scoped
  // in the service layer, so patients:read means "read MY profiles", not the roster. They need
  // patients:* to manage their own and their dependants' profiles, tests:assign because the
  // booking wizard attaches tests to the visit it just created, and billing:read to see their own
  // payment history.
  //
  // hmo:request and hmo:read are the same shape: a patient states their own coverage while
  // booking and looks at the card photo they themselves attached. Neither reaches the staff HMO
  // screens — GET /hmo/requests and GET /hmo/request/:id are `authorizeStaff`, which no permission
  // tick can cross — and hmoService checks ownership on both patient-facing routes.
  Client: [
    'patients:create', 'patients:read', 'patients:update',
    'appointments:create', 'appointments:read', 'appointments:cancel',
    'tests:assign', 'billing:read',
    'visits:read', 'results:read',
    'hmo:request', 'hmo:read',
  ],
};

const setupRbac = async () => {
  try {
    logger.info('Seeding dynamic RBAC data (permissions + role_permissions)…');
    logger.info('Precondition: the permissions/role_permissions tables must exist — run migrateDb.js first.');

    await db.withTransaction(async () => {
      for (const p of PERMISSIONS) {
        await db.query(
          `INSERT INTO permissions (name, module, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (name) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description`,
          [p.name, p.module, p.description]
        );
      }

      const roleMap = {};
      (await db.query('SELECT id, name FROM roles')).rows.forEach((r) => { roleMap[r.name] = r.id; });
      const permMap = {};
      (await db.query('SELECT id, name FROM permissions')).rows.forEach((p) => { permMap[p.name] = p.id; });

      for (const [roleName, permList] of Object.entries(ROLE_PERMISSIONS)) {
        const roleId = roleMap[roleName];
        if (!roleId) {
          logger.warn(`  role "${roleName}" is not seeded — skipped`);
          continue;
        }
        const ids = permList.map((n) => permMap[n]).filter(Boolean);
        // Set-based, and ON CONFLICT DO NOTHING so re-running never revokes a deliberate change.
        await db.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT $1, unnest($2::int[])
           ON CONFLICT DO NOTHING`,
          [roleId, ids]
        );
      }
    });

    const summary = await db.query(`
      SELECT r.name AS role, COUNT(rp.permission_id)::int AS granted
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      GROUP BY r.name
      ORDER BY granted DESC, r.name
    `);
    logger.info(`Seeded ${PERMISSIONS.length} permissions. Current matrix:`);
    for (const row of summary.rows) logger.info(`   ${row.role.padEnd(18)} ${row.granted}`);
    logger.info('Dynamic RBAC setup completed successfully!');
    process.exit(0);
  } catch (err) {
    logger.error('RBAC setup failed:', err);
    process.exit(1);
  }
};

setupRbac();
