/**
 * Cross-checks every permission-gated route against the seeded role-permission matrix.
 *
 * Wiring `authorizePermissions` onto a route that one of its own `authorizeRoles` entries lacks
 * the permission for does not fail loudly — it produces a 403 for a role the route was explicitly
 * written to allow, in a flow nobody may exercise until a real user hits it. That is the exact
 * hazard the old "do not wire this ad hoc" note in auth.js warned about, and eyeballing 84 routes
 * is not a control.
 *
 * So this reads the route files, extracts every (roles, permission) pair, and asserts that each
 * named role actually holds that permission in the database. Run it after any change to routes or
 * to setupRbac.js.
 *
 *   node src/scripts/verifyRbacWiring.js
 *
 * Exits non-zero on a mismatch, so it can gate a deploy.
 */
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../config/logger');

const ROUTES_DIR = path.join(__dirname, '..', 'routes');

// Roles that legitimately bypass the permission layer, so a gap for them is not a finding.
const BYPASS = new Set(['SuperAdmin']);

function extractRouteGuards(source) {
  const found = [];
  // One router.<verb>( ... ) call per line is the convention throughout this codebase.
  for (const line of source.split('\n')) {
    if (!/^router\.(get|post|put|patch|delete)\(/.test(line.trim())) continue;
    const permMatch = line.match(/authorizePermissions\(([^)]*)\)/);
    if (!permMatch) continue;

    const perms = [...permMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const rolesMatch = line.match(/authorizeRoles\(([^)]*)\)/);
    const roles = rolesMatch ? [...rolesMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
    const spread = rolesMatch ? [...rolesMatch[1].matchAll(/\.\.\.([A-Z_]+)/g)].map((m) => m[1]) : [];

    const pathMatch = line.match(/router\.\w+\('([^']*)'/);
    found.push({ path: pathMatch ? pathMatch[1] : '?', perms, roles, spread, line: line.trim() });
  }
  return found;
}

/** Resolves `...SOME_CONST` role lists declared as an array literal in the same file. */
function resolveConstants(source) {
  const consts = {};
  for (const m of source.matchAll(/const\s+([A-Z_]+)\s*=\s*\[([^\]]*)\]/g)) {
    consts[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  return consts;
}

async function main() {
  const matrix = {};
  const rows = await db.query(`
    SELECT r.name AS role, p.name AS permission
    FROM roles r
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
  `);
  for (const row of rows.rows) {
    (matrix[row.role] = matrix[row.role] || new Set()).add(row.permission);
  }

  const problems = [];
  let gated = 0;

  for (const file of fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const consts = resolveConstants(source);

    for (const route of extractRouteGuards(source)) {
      gated += 1;
      const roles = [...route.roles, ...route.spread.flatMap((name) => consts[name] || [])];
      if (roles.length === 0) continue; // permission-only route; nothing to cross-check

      for (const role of roles) {
        if (BYPASS.has(role)) continue;
        for (const perm of route.perms) {
          if (!matrix[role] || !matrix[role].has(perm)) {
            problems.push(`${file} ${route.path} — role "${role}" is allowed by authorizeRoles but lacks "${perm}"`);
          }
        }
      }
    }
  }

  logger.info(`Checked ${gated} permission-gated route(s) against the seeded matrix.`);
  if (problems.length === 0) {
    logger.info('All good — every role a route allows also holds the permission it requires.');
    process.exit(0);
  }

  logger.error(`${problems.length} mismatch(es) — these roles would get a 403 on a route written to allow them:`);
  for (const p of problems) logger.error(`   ${p}`);
  logger.error('Fix by granting the permission in setupRbac.js, or by narrowing the route\'s role list.');
  process.exit(1);
}

main().catch((err) => {
  logger.error(`RBAC wiring check failed: ${err.message}`);
  process.exit(1);
});
