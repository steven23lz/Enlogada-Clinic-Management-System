/**
 * Every API route, called by everyone who should be refused it. [1.173.0]
 *
 * Reads the route files, works out from each route's own gates (verifyToken, authorizeStaff,
 * authorizeRoles, authorizePermissions) and each seeded account's permissions who must be turned
 * away, and calls the route as each of them and with no sign-in. A refusal is 401 or 403; anything
 * else is a way past the gates. Needs the backend running and the seeded accounts. Read-only for a
 * correct server: a refused request does nothing.
 *
 *   node src/scripts/probeRouteGates.js
 *
 * A role list written as a named constant (`...DISCOUNT_GRANT_ROLES`) is read as unknown and skipped.
 */
const fs = require('fs');
const path = require('path');
const B = path.join(__dirname, '..');
const API = process.env.PROBE_API || 'http://localhost:5000';

const app = fs.readFileSync(`${B}/app.js`, 'utf8');
const requires = Object.fromEntries([...app.matchAll(/const (\w+) = require\('\.\/routes\/(\w+)'\)/g)].map((m) => [m[1], m[2]]));
const mounts = [...app.matchAll(/app\.use\('(\/api\/[\w-]+)',\s*(\w+)\)/g)].filter((m) => requires[m[2]]).map((m) => ({ prefix: m[1], file: requires[m[2]] }));

function calls(src, name) {
  const out = [];
  const re = new RegExp(`router\\.(${name})\\(`, 'g');
  let m;
  while ((m = re.exec(src))) {
    let depth = 1; let i = re.lastIndex;
    while (i < src.length && depth) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; i++; }
    out.push({ method: m[1], body: src.slice(re.lastIndex, i - 1) });
  }
  return out;
}

const routes = [];
for (const { prefix, file } of mounts) {
  const src = fs.readFileSync(`${B}/routes/${file}.js`, 'utf8').replace(/\/\/.*$/gm, '');
  const fileLevel = calls(src, 'use').map((c) => c.body).join(' ');
  for (const { method, body } of calls(src, 'get|post|put|patch|delete')) {
    const p = (body.match(/^\s*['"`]([^'"`]+)['"`]/) || [])[1];
    if (!p) continue;
    const all = `${fileLevel} ${body}`;
    routes.push({
      method: method.toUpperCase(), path: prefix + (p === '/' ? '' : p),
      token: /verifyToken/.test(all),
      staff: /authorizeStaff/.test(all),
      roles: [...all.matchAll(/authorizeRoles\(([^)]*)\)/g)].map((r) => r[1].match(/'[^']+'/g)?.map((x) => x.slice(1, -1)) || null).filter(Boolean),
      perms: [...all.matchAll(/authorizePermissions\(([^)]*)\)/g)].flatMap((r) => r[1].match(/'[^']+'/g)?.map((x) => x.slice(1, -1)) || []),
    });
  }
}

const decode = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
const accounts = ['client@enlogada.com', 'receptionist@enlogada.com', 'cashier@enlogada.com', 'lab@enlogada.com', 'ultrasound@enlogada.com', 'xray@enlogada.com', 'clinicadmin@enlogada.com'];

function allowed(r, u) {
  if (!r.token) return true;
  if (!u) return false;
  const staff = u.roles.some((x) => x !== 'Client');
  if (r.staff && !staff) return false;
  for (const list of r.roles) if (!u.roles.some((x) => list.includes(x))) return false;
  if (r.perms.length && !u.roles.includes('SuperAdmin') && !r.perms.every((p) => u.permissions.includes(p))) return false;
  return true;
}

(async () => {
  const users = [{ name: 'nobody', token: null, claims: null }];
  for (const email of accounts) {
    const res = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password123!' }) });
    const token = (await res.json()).data?.token;
    if (!token) { console.log('could not sign in', email); continue; }
    const c = decode(token);
    users.push({ name: email.split('@')[0], token, claims: { roles: c.roles || [], permissions: c.permissions || [] } });
  }
  const findings = [];
  let probes = 0;
  for (const r of routes) {
    for (const u of users) {
      if (allowed(r, u.claims)) continue;
      const url = API + r.path.replace(/:\w+/g, '999999');
      const res = await fetch(url, {
        method: r.method,
        headers: { 'Content-Type': 'application/json', ...(u.token ? { Authorization: `Bearer ${u.token}` } : {}) },
        body: r.method === 'GET' ? undefined : '{}',
      });
      probes++;
      if (![401, 403].includes(res.status)) findings.push(`${res.status} ${r.method} ${r.path} as ${u.name}`);
    }
  }
  console.log(`${routes.length} routes, ${users.length} callers, ${probes} probes that should be refused`);
  console.log(findings.length ? findings.join('\n') : 'every one refused');
  console.log('public routes:', routes.filter((r) => !r.token).map((r) => `${r.method} ${r.path}`).join(', '));
})();
