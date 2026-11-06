/**
 * Figure 2, the System Architecture, in the layout and colours of the paper's first version.
 *
 *   node docs/diagrams/buildArchitecture.cjs
 *
 * Writes system-architecture.drawio, which opens and edits in draw.io like the other figures. Each
 * box names something real: MODULES lists the route files behind each back-end module, JOBS the
 * files in backend/src/jobs, and STORES the tables behind each data store. The script fails if a
 * table, a route file or a job is left out, so a new one has to be placed before this builds.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ICONS = path.join(ROOT, 'frontend', 'node_modules', 'lucide-react', 'dist', 'esm', 'icons');

const FRONT = [
  ['Public Website', 'globe'],
  ['Client/Patient Portal', 'user-round'],
  ['Receptionist Desk', 'concierge-bell'],
  ['Cashier', 'credit-card'],
  ['Laboratory Dashboard', 'flask-conical'],
  ['Ultrasound Dashboard', 'activity'],
  ['X-ray Dashboard', 'bone'],
  ['Admin Dashboard', 'settings'],
  ['Super Admin', 'user-cog'],
];

const COMMON = [
  ['Authentication & Role Access Service', 'shield-check'],
  ['CORS, Helmet & Rate Limiting Services', 'shield'],
  ['Activity Log Service', 'clipboard-list'],
];

// [label, icon, ink, route files]
const MODULES = [
  ['Appointment & QR Module', 'calendar-check', '#1d4ed8', ['appointmentRoutes']],
  ['Walk-In Registration & Queue Module', 'user-plus', '#0f766e', ['visitRoutes']],
  ['Patient Record Management Module', 'folder-open', '#92400e', ['patientRoutes']],
  ['Clinic Schedule Module', 'calendar-clock', '#6d28d9', ['scheduleRoutes', 'clinicRoutes']],
  ['Services & Packages Module', 'package', '#b45309', ['testRoutes', 'packageRoutes']],
  ['Billing, Receipt & Refund Module', 'receipt', '#15803d', ['paymentRoutes', 'discountRoutes']],
  ['Online Payment Verification Module', 'wallet', '#1d4ed8', ['paymentSubmissionRoutes', 'paymentMethodRoutes']],
  ['Cash Count Module', 'banknote', '#15803d', ['cashCountRoutes']],
  ['HMO Claim Module', 'shield-plus', '#be123c', ['hmoRoutes']],
  ['Diagnostic Results Uploading Module', 'file-up', '#111827', ['resultRoutes']],
  ['Report Verification Module', 'qr-code', '#111827', ['verificationRoutes']],
  ['Reporting Module', 'chart-column', '#4f46e5', ['reportRoutes']],
  ['Patient Feedback Module', 'message-square', '#0f766e', ['feedbackRoutes']],
  ['Staff Notification Module', 'bell', '#b45309', ['notificationRoutes']],
  ['User Account & Access Module', 'users-round', '#111827', ['authRoutes', 'adminRoutes', 'rbacRoutes', 'superAdminRoutes']],
  ['Email Notification Module', 'mail', '#dc2626', []],
];

// [label, icon, job file]
const JOBS = [
  ['Appointment Reminders', 'alarm-clock', 'reminderScheduler'],
  ['Unpaid Booking Removal', 'timer-off', 'unpaidExpiryScheduler'],
  ['Overdue Result Alerts', 'triangle-alert', 'overdueResultScheduler'],
  ['Automatic Patient Emails', 'mail-check', 'patientMessageScheduler'],
  ['Nightly Backup', 'database-backup', 'backupScheduler'],
  ['Records Retention', 'archive', 'retentionScheduler'],
];

// [label, tables]
const STORES = [
  ['User & Access Data', ['users', 'roles', 'user_roles', 'permissions', 'role_permissions', 'user_permissions', 'user_departments', 'auth_codes']],
  ['Patient Record Data', ['patients', 'patient_types', 'patient_invitations']],
  ['Visit & Queue Data', ['patient_visits', 'daily_counters']],
  ['Appointment Data', ['appointments']],
  ['Service & Package Data', ['tests', 'test_categories', 'test_packages', 'test_package_items', 'visit_tests']],
  ['Test Result Data', ['test_results']],
  ['Payment & Refund Data', ['payments', 'payment_methods', 'payment_submissions', 'payment_refunds', 'payment_refund_tests', 'discount_types', 'cash_counts']],
  ['HMO Claim Data', ['hmo_providers', 'hmo_requests', 'hmo_request_tests']],
  ['Schedule & Settings Data', ['clinic_operating_hours', 'clinic_schedule_overrides', 'clinic_settings']],
  ['Notification Data', ['notification_events', 'notification_reads']],
  ['Feedback Data', ['feedback_questions', 'visit_feedback_answers']],
  ['Activity Log Data', ['audit_log']],
];

const DEVICES = [
  ['Client/Patient Devices', 'smartphone'],
  ['Receptionist Workstation', 'monitor'],
  ['Cashier Workstation', 'monitor'],
  ['Laboratory Workstation', 'monitor'],
  ['Ultrasound Workstation', 'monitor'],
  ['X-ray Workstation', 'monitor'],
  ['Admin Workstation', 'monitor'],
  ['Super Admin Workstation', 'monitor'],
  ['Public Visitor Device', 'smartphone'],
];

// ----- Nothing real may be left off the figure.
function assertComplete() {
  const schema = fs.readFileSync(path.join(ROOT, 'database', 'schema.sql'), 'utf8');
  const tables = [...schema.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/g)].map((m) => m[1]);
  const placed = new Set(STORES.flatMap((s) => s[1]));
  const missingTables = tables.filter((t) => !placed.has(t));
  const staleTables = [...placed].filter((t) => !tables.includes(t));
  const routes = fs.readdirSync(path.join(ROOT, 'backend', 'src', 'routes')).map((f) => f.replace(/\.js$/, ''));
  const placedRoutes = new Set(MODULES.flatMap((m) => m[3]));
  const missingRoutes = routes.filter((r) => !placedRoutes.has(r));
  const staleRoutes = [...placedRoutes].filter((r) => !routes.includes(r));
  const jobs = fs.readdirSync(path.join(ROOT, 'backend', 'src', 'jobs')).map((f) => f.replace(/\.js$/, '')).filter((j) => j !== 'periodic');
  const placedJobs = new Set(JOBS.map((j) => j[2]));
  const missingJobs = jobs.filter((j) => !placedJobs.has(j));
  const staleJobs = [...placedJobs].filter((j) => !jobs.includes(j));
  const wrong = { missingTables, staleTables, missingRoutes, staleRoutes, missingJobs, staleJobs };
  if (Object.values(wrong).some((list) => list.length)) throw new Error(`The figure does not match the system: ${JSON.stringify(wrong)}`);
}

// ----- Drawing
const cells = [];
let nextId = 2;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function vertex(value, style, x, y, w, h) {
  const id = `n${nextId++}`;
  cells.push(`<mxCell id="${id}" value="${esc(value)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`);
  return id;
}

function icon(name, ink, x, y, size) {
  const src = fs.readFileSync(path.join(ICONS, `${name}.mjs`), 'utf8');
  const node = new Function(`return ${/const __iconNode = (\[[\s\S]*?\]);\nconst /.exec(src)[1]}`)();
  const body = node.map(([tag, attrs]) => {
    const list = Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${list}/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const data = Buffer.from(svg).toString('base64');
  return vertex('', `shape=image;html=1;imageAspect=1;aspect=fixed;image=data:image/svg+xml,${data};`, x, y, size, size);
}

const FONT = 'fontFamily=Helvetica;html=1;whiteSpace=wrap;fontStyle=1;';
const text = (value, x, y, w, h, { size = 18, color = '#111111', align = 'center', valign = 'top' } = {}) =>
  vertex(value, `text;${FONT}fontSize=${size};fontColor=${color};align=${align};verticalAlign=${valign};spacing=0;`, x, y, w, h);
const box = (x, y, w, h, fill, stroke = '#111111') =>
  vertex('', `rounded=0;html=1;fillColor=${fill};strokeColor=${stroke};strokeWidth=1.5;`, x, y, w, h);

/** An icon with its label under it, the way the first figure sets every item. */
function item(label, name, ink, labelColor, x, y, w, { size = 54, font = 18 } = {}) {
  icon(name, ink, x + (w - size) / 2, y, size);
  text(label, x + 4, y + size + 5, w - 8, 68, { size: font, color: labelColor });
}

/** A straight line with its label above it, arrowhead at the far end. `span` keeps the label clear of a frame line. */
function flow(label, x1, y1, x2, y2, { above = 28, size = 17, weight = 2.5, span } = {}) {
  const id = `e${nextId++}`;
  cells.push(`<mxCell id="${id}" value="" style="endArrow=block;endFill=1;html=1;rounded=0;strokeColor=#111111;strokeWidth=${weight};" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${x1}" y="${y1}" as="sourcePoint"/><mxPoint x="${x2}" y="${y2}" as="targetPoint"/></mxGeometry></mxCell>`);
  if (!label) return;
  const [from, to] = span || [Math.min(x1, x2), Math.max(x1, x2)];
  const lines = String(label).split('<br>').length;
  text(label, from, Math.min(y1, y2) - above * lines - 3, to - from, above * lines, { size, valign: 'bottom' });
}

function grid(list, x, y, cols, w, h, draw) {
  list.forEach((entry, i) => draw(entry, x + (i % cols) * w, y + Math.floor(i / cols) * h));
}

function build() {
  // Core system frame, behind everything inside it.
  text('CORE SYSTEM: ENLOGADA ULTRASOUND AND DIAGNOSTIC CLINIC MANAGEMENT SYSTEM', 350, 26, 1370, 28, { size: 22, align: 'left' });
  vertex('', 'rounded=0;html=1;fillColor=none;strokeColor=#111111;strokeWidth=1.5;', 350, 58, 1370, 930);

  // Peripheral devices
  text('Peripheral Devices', 30, 92, 190, 26, { size: 19 });
  box(40, 122, 170, 280, '#4f6b8a');
  item('Printer', 'printer', '#ffffff', '#ffffff', 45, 136, 160, { size: 62 });
  item('Mobile Camera for QR Scan', 'camera', '#ffffff', '#ffffff', 45, 260, 160, { size: 62 });

  // Front end
  box(380, 82, 450, 500, '#6a4c8f');
  text('FRONT-END MODULES: REACT WEB APPLICATION', 392, 92, 432, 24, { size: 16, color: '#ffffff', align: 'left' });
  grid(FRONT, 380, 138, 3, 150, 148, ([label, name], x, y) => item(label, name, '#ffffff', '#ffffff', x, y, 150));

  // Scheduled jobs, which the server runs by itself
  box(380, 620, 450, 340, '#2f6f7e');
  text('SCHEDULED JOBS: RUN BY THE SERVER', 392, 630, 432, 24, { size: 16, color: '#ffffff', align: 'left' });
  grid(JOBS, 380, 668, 3, 150, 146, ([label, name], x, y) => item(label, name, '#ffffff', '#ffffff', x, y, 150));

  // Common services
  text('COMMON SERVICES', 1040, 66, 600, 24, { size: 18 });
  box(1040, 94, 600, 158, '#5f8f57');
  grid(COMMON, 1040, 106, 3, 200, 150, ([label, name], x, y) => item(label, name, '#ffffff', '#ffffff', x, y, 200));

  // Back end
  box(975, 296, 725, 668, '#fbe5e2', '#c0504d');
  text('BACK-END MODULES: NODE JS + EXPRESS', 987, 304, 700, 26, { size: 18, align: 'left' });
  grid(MODULES, 979, 342, 4, 179, 155, ([label, name, ink], x, y) => item(label, name, ink, '#111111', x, y, 179));

  // Database
  vertex('', 'shape=cylinder3;html=1;boundedLbl=1;backgroundOutline=1;size=62;fillColor=#ffffff;strokeColor=#111111;strokeWidth=2;', 1870, 12, 440, 548);
  text('DATABASE SERVICE: POSTGRESQL', 1885, 40, 410, 56, { size: 21, valign: 'middle' });
  grid(STORES, 1890, 136, 4, 101, 134, ([label], x, y) => {
    vertex(label, `shape=cylinder3;${FONT}boundedLbl=1;backgroundOutline=1;size=11;fillColor=#a83a14;strokeColor=#7a2a0e;fontColor=#ffffff;fontSize=14;spacing=1;verticalAlign=middle;`, x, y, 95, 122);
  });

  // Outside services
  const outside = [
    ['File Storage: Reports, Proofs of Payment, IDs', 'hard-drive', '#111827', 'Read / Write Files', 622],
    ['Backup Copy: Second Location', 'database-backup', '#0f766e', 'Encrypted Backup', 730],
    ['Google SMTP / Gmail SMTP', 'mail', '#dc2626', 'SMTP via Nodemailer', 838],
    ['Google Sign-In', 'log-in', '#1d4ed8', 'Verify Google ID Token', 930],
  ];
  outside.forEach(([label, name, ink, flowLabel, y]) => {
    icon(name, ink, 1950, y - 30, 60);
    text(label, 2020, y - 34, 290, 68, { size: 18, align: 'left', valign: 'middle' });
    flow(flowLabel, 1700, y, 1944, y, { above: 26 });
  });

  // Internet and the people using it
  box(50, 468, 150, 132, '#ff5a00');
  item('Internet', 'globe', '#111111', '#111111', 50, 482, 150, { size: 60 });
  text('External Access', 136, 668, 204, 26, { size: 19, align: 'right' });
  box(20, 696, 320, 468, '#ffffff');
  grid(DEVICES, 24, 706, 3, 104, 152, ([label, name], x, y) => item(label, name, '#111111', '#111111', x, y, 104, { size: 58, font: 15 }));

  // The flows
  flow('', 125, 696, 125, 604);
  text('HTTPS', 134, 632, 80, 26, { size: 18, align: 'left' });
  flow('HTTPS Web Request', 200, 534, 376, 534, { above: 26, size: 15, span: [200, 350] });
  flow('Browser Print', 376, 196, 214, 196, { above: 26, span: [214, 350] });
  flow('QR Code Input', 210, 330, 376, 330, { above: 26, span: [210, 350] });
  flow('POST API/AUTH', 830, 180, 1036, 180, { above: 26 });
  flow('API Requests', 830, 470, 971, 470, { above: 26 });
  flow('Run Automatically', 830, 790, 971, 790, { above: 26, size: 15 });
  flow('SQL Verify<br>Credentials', 1640, 180, 1866, 180, { above: 24, span: [1724, 1866] });
  flow('SQL Queries<br>/ CRUD', 1700, 430, 1866, 430, { above: 24, span: [1724, 1866] });
}

assertComplete();
build();

const xml = `<mxfile host="app.diagrams.net" type="device"><diagram id="system-architecture" name="System Architecture"><mxGraphModel dx="2000" dy="1200" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="2340" pageHeight="1190" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>`;
fs.writeFileSync(path.join(__dirname, 'system-architecture.drawio'), xml);
console.log(`system-architecture.drawio: ${FRONT.length} screens, ${MODULES.length} modules, ${JOBS.length} jobs, ${STORES.length} data stores`);
