/**
 * Builds the capstone paper's diagrams as draw.io files, in the same style as the originals.
 *
 * The flowcharts, use cases and data flow diagrams are laid out from the specs below; the ERD is
 * read from the live database, so it cannot drift from the schema. Run from anywhere:
 *
 *   node docs/diagrams/build-diagrams.cjs
 *
 * Output: one .drawio file per group, each with a tab per figure. Open in draw.io to adjust the
 * placement by hand — the layout here is deliberately roomy so boxes can be dragged without
 * crossing lines. Export with export-png.cmd beside this file.
 */
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const BACKEND = path.join(__dirname, '..', '..', 'backend');

// ── draw.io plumbing ────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FONT = 'fontFamily=Helvetica;fontSize=12;';
const SMALL = 'fontFamily=Helvetica;fontSize=11;';
const S = {
  actor: 'shape=actor;fillColor=#E8761A;strokeColor=none;html=1;',
  umlActor: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;fontFamily=Helvetica;fontSize=12;fontStyle=1',
  term: 'ellipse;whiteSpace=wrap;html=1;' + FONT,
  proc: 'rounded=0;whiteSpace=wrap;html=1;' + FONT,
  dec: 'rhombus;whiteSpace=wrap;html=1;' + SMALL,
  io: 'shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;' + FONT,
  entity: 'rounded=0;whiteSpace=wrap;html=1;' + FONT,
  system: 'rounded=0;whiteSpace=wrap;html=1;verticalAlign=middle;' + FONT,
  ellipse: 'ellipse;whiteSpace=wrap;html=1;' + FONT,
  procHead: 'swimlane;whiteSpace=wrap;html=1;startSize=24;horizontal=1;fontStyle=0;' + FONT,
  procBody: 'text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;' + FONT,
  storeTag: 'rounded=0;whiteSpace=wrap;html=1;align=center;' + FONT,
  storeName: 'rounded=0;whiteSpace=wrap;html=1;align=left;spacingLeft=8;' + FONT,
  edge: 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;jettySize=auto;orthogonalLoop=1;' + SMALL,
  edgeStraight: 'edgeStyle=none;rounded=0;html=1;endArrow=none;' + SMALL,
  edgeFlow: 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontColor=#1A4D8F;verticalAlign=bottom;' + SMALL,
  edgeDashed: 'endArrow=open;endSize=12;dashed=1;html=1;' + SMALL,
  table: 'shape=table;startSize=28;container=1;collapsible=0;childLayout=tableLayout;fixedRows=1;rowLines=0;fontStyle=1;align=center;resizeLast=1;html=1;fillColor=#DAE8FC;strokeColor=#6C8EBF;fontFamily=Helvetica;fontSize=12;',
  tableGhost: 'shape=table;startSize=28;container=1;collapsible=0;childLayout=tableLayout;fixedRows=1;rowLines=0;fontStyle=2;align=center;resizeLast=1;html=1;fillColor=#F5F5F5;strokeColor=#B3B3B3;fontColor=#666666;fontFamily=Helvetica;fontSize=12;',
  tableRow: 'shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=none;collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;top=0;left=0;right=0;bottom=0;',
  tableCell: 'shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;align=left;spacingLeft=6;overflow=hidden;html=1;fontFamily=Helvetica;fontSize=11;',
  erEdge: 'edgeStyle=entityRelationEdgeStyle;fontSize=11;html=1;endArrow=ERmandOne;startArrow=ERmany;rounded=0;strokeColor=#6C8EBF;',
  note: 'shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;darkOpacity=0.05;fillColor=#FFF2CC;strokeColor=#D6B656;align=left;spacingLeft=6;' + SMALL,
};

class Page {
  constructor(name) { this.name = name; this.cells = []; this.n = 0; }
  id(prefix = 'n') { this.n += 1; return `${prefix}${this.n}`; }
  node(value, x, y, w, h, style, parent = '1') {
    const id = this.id();
    this.cells.push(`<mxCell id="${id}" value="${esc(value)}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" /></mxCell>`);
    return { id, x, y, w, h };
  }
  edge(from, to, label = '', style = S.edge, points = []) {
    const id = this.id('e');
    const geo = points.length
      ? `<mxGeometry relative="1" as="geometry"><Array as="points">${points.map((p) => `<mxPoint x="${p[0]}" y="${p[1]}" />`).join('')}</Array></mxGeometry>`
      : '<mxGeometry relative="1" as="geometry" />';
    this.cells.push(`<mxCell id="${id}" value="${esc(label)}" style="${style}" edge="1" parent="1" source="${from.id}" target="${to.id}">${geo}</mxCell>`);
  }
  xml() {
    return `  <diagram id="${this.name.replace(/[^A-Za-z0-9]/g, '')}" name="${esc(this.name)}">\n`
      + '    <mxGraphModel dx="1200" dy="800" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1100" math="0" shadow="0">\n'
      + '      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n        '
      + this.cells.join('\n        ')
      + '\n      </root>\n    </mxGraphModel>\n  </diagram>\n';
  }
}

function writeFile(file, pages) {
  const xml = '<mxfile host="Electron" agent="build-diagrams.cjs" type="device">\n'
    + pages.map((p) => p.xml()).join('')
    + '</mxfile>\n';
  fs.writeFileSync(path.join(OUT, file), xml);
  console.log(`${file}: ${pages.length} page(s)`);
}

// ── 1. Flowcharts ───────────────────────────────────────────────────────────────────────────────
// A chart is an actor, a preamble (login / access check / landing screen) and columns of steps that
// all meet at one End, which is how the originals in the paper are drawn.
const NODE_W = 210, NODE_H = 58, DEC_H = 76, V_GAP = 46, SIDE_W = 190, COL_GAP = 48;

function kindStyle(k) {
  return k === 'dec' ? S.dec : k === 'io' ? S.io : k === 'term' ? S.term : S.proc;
}

function flowchart(spec) {
  const p = new Page(spec.name);
  const columns = spec.columns;
  // Column x positions: a column is wider when one of its steps has a side branch.
  const widths = columns.map((col) => NODE_W + (col.some((s) => s.side) ? SIDE_W + 36 : 0));
  const xs = [];
  let x = 60;
  widths.forEach((w) => { xs.push(x); x += w + COL_GAP; });
  const totalW = x - COL_GAP - 60;

  p.node(spec.actor, 60, 20, 30, 50, S.actor);
  const start = p.node(spec.start || 'Login', 40, 96, 150, 44, S.term);
  let landing;
  if (spec.gate === false) {
    landing = p.node(spec.landing, 40, 180, NODE_W, NODE_H, S.proc);
    p.edge(start, landing);
  } else {
    const gate = p.node('Access Granted?', 30, 176, 170, 80, S.dec);
    landing = p.node(spec.landing, 300, 187, NODE_W, NODE_H, S.proc);
    p.edge(start, gate);
    p.edge(gate, landing, 'yes');
    p.edge(gate, start, 'no', S.edge, [[-30, 216], [-30, 118]]);
  }

  const topY = 320;
  let lowest = topY;
  const lastOfColumn = [];
  const merges = [];
  columns.forEach((col, ci) => {
    const cx = xs[ci];
    let y = topY;
    // Place every step in the column first, so a side branch knows the step it rejoins.
    const main = col.map((step) => {
      const h = step.k === 'dec' ? DEC_H : NODE_H;
      const cell = p.node(step.l, cx, y, NODE_W, h, kindStyle(step.k));
      const at = { cell, y, h };
      y += h + V_GAP;
      lowest = Math.max(lowest, y);
      return at;
    });
    main.forEach((at, si) => {
      const step = col[si];
      if (si === 0) p.edge(landing, at.cell);
      else p.edge(main[si - 1].cell, at.cell, col[si - 1].k === 'dec' ? (col[si - 1].mainLabel || 'yes') : '');
      if (step.side) {
        const side = p.node(step.side.l, cx + NODE_W + 36, at.y + (at.h - NODE_H) / 2, SIDE_W, NODE_H, kindStyle(step.side.k || 'proc'));
        p.edge(at.cell, side, step.side.label || 'yes');
        const rejoin = main[si + (step.side.mergeTo || 1)];
        if (step.side.back) {
          p.edge(side, at.cell, '', S.edge, [[cx + NODE_W + 36 + SIDE_W / 2, at.y - 26], [cx + NODE_W / 2, at.y - 26]]);
        } else if (step.side.toEnd || !rejoin) {
          merges.push(side);               // a branch that finishes here, e.g. a refusal
        } else {
          p.edge(side, rejoin.cell);
        }
      }
    });
    lastOfColumn.push(main[main.length - 1].cell);
  });

  const end = p.node('End', 60 + totalW / 2 - 60, lowest + 30, 120, 44, S.term);
  lastOfColumn.concat(merges).forEach((cell) => p.edge(cell, end));
  return p;
}

const SUPER_ADMIN_FLOW = {
  name: 'Super Admin', actor: 'Super Admin', landing: 'Today',
  columns: [
    [{ k: 'proc', l: 'Who Sees What' }, { k: 'proc', l: "Change a role's permissions" }, { k: 'proc', l: 'Review the listed changes' }, { k: 'proc', l: 'Save changes' }],
    [{ k: 'proc', l: 'One Person' }, { k: 'proc', l: 'Grant or revoke access for one account' }, { k: 'proc', l: 'Change recorded in the Activity Log' }],
    [{ k: 'proc', l: 'Staff Accounts' }, { k: 'proc', l: 'Create, update or deactivate an account' }],
    [{ k: 'proc', l: 'Services Catalog' }, { k: 'proc', l: 'Add or update a test, price or package' }],
    [{ k: 'proc', l: 'Payment Methods' }, { k: 'proc', l: "Publish the clinic's GCash account and QR" }],
    [{ k: 'proc', l: 'Clinic Schedule' }, { k: 'proc', l: 'Set weekly hours or a date override' }],
    [{ k: 'proc', l: 'Reports' }, { k: 'proc', l: 'View clinic analytics' }, { k: 'io', l: 'Export CSV' }],
    [{ k: 'proc', l: 'Activity Log' }, { k: 'proc', l: 'Review the audit trail' }],
  ],
};

const ADMIN_FLOW = {
  name: 'Admin', actor: 'Admin', landing: 'Today',
  columns: [
    [{ k: 'proc', l: 'Service Requests' }, { k: 'proc', l: 'Open an HMO claim' },
      { k: 'dec', l: 'Approve the claim?', mainLabel: 'yes', side: { l: 'Record the refusal reason', label: 'no', mergeTo: 2 } },
      { k: 'proc', l: 'Record the approval code' }, { k: 'proc', l: 'Cashier is notified of the decision' }],
    [{ k: 'proc', l: 'Appointments' }, { k: 'proc', l: 'View or update a booking' }],
    [{ k: 'proc', l: 'Patient Records' }, { k: 'proc', l: 'Search and correct a record' }, { k: 'io', l: 'Print record or result' }],
    [{ k: 'proc', l: 'Cashier Monitoring' }, { k: 'proc', l: 'Review payments and reversals' }],
    [{ k: 'proc', l: 'Staff Accounts' }, { k: 'proc', l: 'Create or update a staff account' }],
    [{ k: 'proc', l: 'Reports' }, { k: 'proc', l: 'Generate a report' }, { k: 'io', l: 'Print or export CSV' }],
    [{ k: 'proc', l: 'Activity Log' }, { k: 'proc', l: 'Review the audit trail' }],
  ],
};

const RECEPTIONIST_FLOW = {
  name: 'Receptionist', actor: 'Receptionist', landing: 'Desk',
  columns: [
    [{ k: 'proc', l: 'Search a name, queue number or reference' },
      { k: 'dec', l: "Booking for today?", mainLabel: 'yes', side: { l: 'Scan the QR code on the pass', label: 'scan' } },
      { k: 'proc', l: 'Check in the patient' },
      { k: 'proc', l: "Stamp arrival and issue today's queue ticket" },
      { k: 'dec', l: 'Already paid?', mainLabel: 'yes', side: { l: 'Send the patient to the cashier', label: 'no', toEnd: true } },
      { k: 'proc', l: 'Released to the department worklist' }],
    [{ k: 'proc', l: 'Record on file, no booking' }, { k: 'proc', l: 'Start a visit' }, { k: 'proc', l: 'Attach the requested tests' }, { k: 'proc', l: 'Issue the queue ticket' }],
    [{ k: 'proc', l: 'Nobody on file' }, { k: 'proc', l: 'Register walk-in' }, { k: 'proc', l: 'Create the record and the visit' }, { k: 'proc', l: 'Issue the queue ticket' }],
    [{ k: 'dec', l: 'HMO patient?', mainLabel: 'yes' }, { k: 'proc', l: 'Record member number and upload the HMO card' }, { k: 'proc', l: 'Name the referring physician' }, { k: 'proc', l: 'Raise the claim for an Admin decision' }],
    [{ k: 'proc', l: 'Booking not arrived' }, { k: 'proc', l: 'Mark as No-Show' }],
    [{ k: 'proc', l: 'Visit History' }, { k: 'proc', l: 'Review earlier visits' }],
  ],
};

const CASHIER_FLOW = {
  name: 'Cashier', actor: 'Cashier', landing: 'Billing Queue',
  columns: [
    [{ k: 'proc', l: 'Select a patient who is here' },
      { k: 'proc', l: 'Bill built from the attached tests and packages' },
      { k: 'dec', l: 'Senior Citizen or PWD?', mainLabel: 'no', side: { l: 'Apply the 20% statutory discount', label: 'yes' } },
      { k: 'proc', l: 'Choose Cash, GCash or Bank' },
      { k: 'proc', l: 'Enter cash tendered and give change' },
      { k: 'proc', l: 'Take payment and issue the receipt number' },
      { k: 'io', l: 'Print the receipt' },
      { k: 'proc', l: 'Visit released to the department if checked in' }],
    [{ k: 'proc', l: 'Online Payments' }, { k: 'proc', l: 'Open the uploaded proof of payment' },
      { k: 'proc', l: 'Compare amount claimed with amount due' },
      { k: 'dec', l: 'Proof verified?', mainLabel: 'yes', side: { l: 'Reject with a reason and email the patient', label: 'no', toEnd: true } },
      { k: 'proc', l: 'Record the payment and issue the receipt' }],
    [{ k: 'proc', l: 'Transaction History' }, { k: 'proc', l: 'Select a date range' }, { k: 'proc', l: 'View takings and receipts' }, { k: 'io', l: 'Print a receipt copy' }],
    [{ k: 'proc', l: 'Reverse a receipt' }, { k: 'proc', l: 'Record the refund on its own date' }],
  ],
};

function departmentFlow(dept, formStep) {
  return {
    name: dept, actor: `${dept} Staff`, landing: `${dept} Worklist`,
    columns: [
      [{ k: 'proc', l: 'View the released tickets for this department' },
        { k: 'proc', l: 'Select a ticket and perform the test' },
        { k: 'proc', l: formStep },
        { k: 'dec', l: 'Critical value?', mainLabel: 'no', side: { l: 'Phone the physician and record the call', label: 'yes' } },
        { k: 'proc', l: 'Save the result' },
        { k: 'proc', l: 'Release the result, recording who and when' },
        { k: 'io', l: 'Print the report' },
        { k: 'proc', l: 'Email the report and record the delivery' }],
      [{ k: 'proc', l: 'Open a released result' }, { k: 'proc', l: 'Amend the findings' }, { k: 'proc', l: 'Save as a new version' }, { k: 'proc', l: 'Earlier version kept and still readable' }],
      [{ k: 'proc', l: `${dept} History` }, { k: 'proc', l: 'Search by patient or queue number' }, { k: 'io', l: 'View or reprint the report' }],
    ],
  };
}

const CLIENT_FLOW = {
  name: 'Client Patient', actor: 'Client / Patient', landing: 'View the services and tests', gate: false,
  start: 'Open the Enlogada website',
  columns: [
    [{ k: 'proc', l: 'Book a visit' },
      { k: 'dec', l: 'Already have an account?', mainLabel: 'yes', side: { l: 'Register and enter the 6-digit code emailed to you', label: 'no' } },
      { k: 'proc', l: 'Select or add a patient profile' },
      { k: 'proc', l: 'Choose a date and an available time' },
      { k: 'proc', l: 'Select the tests or a package' }],
    [{ k: 'dec', l: 'Covered by HMO?', mainLabel: 'no', side: { l: 'Enter the member number and upload the HMO card', label: 'yes' } },
      { k: 'proc', l: 'Confirm the booking' },
      { k: 'proc', l: 'Reference and QR code issued, no queue number yet' },
      { k: 'proc', l: 'Confirmation email with the preparation instructions' }],
    [{ k: 'dec', l: 'Pay before the visit?', mainLabel: 'no', side: { l: "Send payment to the clinic's GCash and upload the proof", label: 'yes' } },
      { k: 'proc', l: 'Arrive at the clinic' },
      { k: 'proc', l: 'The desk scans the QR code' },
      { k: 'proc', l: 'Queue ticket issued' }],
    [{ k: 'proc', l: 'Tests performed by the department' },
      { k: 'proc', l: 'Result released and emailed' },
      { k: 'io', l: 'View or print the result in the portal' }],
  ],
};

// ── 2. Use case diagrams ────────────────────────────────────────────────────────────────────────
function useCase(spec) {
  const p = new Page(spec.name);
  const gap = 16, h = 50, w = 250;
  const total = spec.cases.length * (h + gap) - gap;
  p.node(spec.actor, 60, 80 + total / 2 - 50, 50, 100, S.umlActor);
  const placed = {};
  spec.cases.forEach((label, i) => {
    const y = 80 + i * (h + gap);
    const cell = p.node(label, 320, y, w, h, S.ellipse);
    placed[label] = cell;
    p.edge({ id: p.cells[0].match(/id="(n\d+)"/)[1] }, cell, '', S.edgeStraight);
  });
  (spec.relations || []).forEach((rel) => {
    const from = placed[rel.from];
    if (!from) return;
    const cell = p.node(rel.to, 680, from.y, w, h, S.ellipse);
    p.edge(from, cell, rel.kind === 'include' ? '«include»' : '«extend»', S.edgeDashed);
  });
  return p;
}

const USE_CASES = [
  { name: 'Super Admin', actor: 'Super Admin',
    cases: ['Login', 'Manage Roles and Permissions', 'Manage Per-Account Access', 'Manage Staff and Admin Accounts', 'Manage Services, Packages and Pricing', 'Publish Payment Channels', 'Manage Clinic Schedule', 'View System Analytics', 'View Activity Log', 'Archive and Restore Patient Records', 'Logout'],
    relations: [{ from: 'Manage Roles and Permissions', to: 'Record Change in Activity Log', kind: 'include' }] },
  { name: 'Admin', actor: 'Admin',
    cases: ['Login', 'View Today', 'Decide HMO Claims', 'Manage Staff Accounts', 'Manage Appointments', 'Manage Patient Records', 'Monitor Cashier Transactions', 'Generate Reports', 'View Activity Log', 'Logout'],
    relations: [{ from: 'Manage Patient Records', to: 'Print Records and Results', kind: 'extend' }, { from: 'Generate Reports', to: 'Export CSV', kind: 'extend' }] },
  { name: 'Receptionist', actor: 'Receptionist',
    cases: ['Login', 'View Today', 'Find Patient or Booking', 'Verify QR Code', 'Check In Patient', 'Register Walk-In', 'Assign Tests to a Visit', 'Raise HMO Claim', 'Mark No-Show', 'View Visit History', 'Logout'],
    relations: [{ from: 'Check In Patient', to: 'Issue Queue Ticket', kind: 'include' }, { from: 'Register Walk-In', to: 'Create Patient Record', kind: 'include' }] },
  { name: 'Cashier', actor: 'Cashier',
    cases: ['Login', 'View Today', 'Process Billing and Payment', 'Apply Statutory Discount', 'Review Online Payment Proof', 'Reverse a Payment', 'View Transaction History', 'Logout'],
    relations: [{ from: 'Process Billing and Payment', to: 'Issue Receipt', kind: 'include' }, { from: 'View Transaction History', to: 'Print Receipt Copy', kind: 'extend' }] },
  { name: 'Laboratory Staff', actor: 'Laboratory Staff',
    cases: ['Login', 'View Laboratory Worklist', 'Record Laboratory Result', 'Record Critical Value Callback', 'Release Result', 'Email Result to Patient', 'Amend Released Result', 'Search Result History', 'Logout'],
    relations: [{ from: 'Search Result History', to: 'Print Laboratory Result', kind: 'extend' }, { from: 'Release Result', to: 'Record Delivery', kind: 'include' }] },
  { name: 'Ultrasound Staff', actor: 'Ultrasound Staff',
    cases: ['Login', 'View Ultrasound Worklist', 'Record Measurements and Findings', 'Record Critical Value Callback', 'Release Result', 'Email Result to Patient', 'Amend Released Result', 'Search Result History', 'Logout'],
    relations: [{ from: 'Search Result History', to: 'Print Ultrasound Result', kind: 'extend' }, { from: 'Release Result', to: 'Record Delivery', kind: 'include' }] },
  { name: 'Xray Staff', actor: 'X-Ray Staff',
    cases: ['Login', 'View X-Ray Worklist', 'Record X-Ray Findings', 'Record Critical Value Callback', 'Release Result', 'Email Result to Patient', 'Amend Released Result', 'Search Result History', 'Logout'],
    relations: [{ from: 'Search Result History', to: 'Print X-Ray Result', kind: 'extend' }, { from: 'Release Result', to: 'Record Delivery', kind: 'include' }] },
  { name: 'Client Patient', actor: 'Client / Patient',
    cases: ['Register Account', 'Login', 'View Available Services', 'Manage Patient Profiles', 'Book Appointment', 'Reschedule or Cancel Booking', 'Pay Online and Upload Proof', 'View Diagnostic Results', 'View Receipt', 'Manage Account Profile', 'Logout'],
    relations: [{ from: 'Register Account', to: 'Verify Emailed Code', kind: 'include' }, { from: 'Book Appointment', to: 'Generate QR Booking Pass', kind: 'include' }, { from: 'Login', to: 'Sign In with Google', kind: 'extend' }] },
];

// ── 3. DFD level 0 ──────────────────────────────────────────────────────────────────────────────
const SYSTEM_NAME = 'Enlogada Ultrasound and Diagnostic\nClinic Management System';

function dfd0(spec) {
  const p = new Page(spec.name);
  const rows = spec.inputs.length;
  const topBand = 60, bandGap = 34;
  const sysY = topBand + rows * bandGap + 80;
  const sys = p.node(SYSTEM_NAME.replace('\n', ' '), 120, sysY, 320, 110, S.system);
  const ent = p.node(spec.name, 900, sysY - 60, 210, 90, S.entity);

  spec.inputs.forEach((label, i) => {
    const y = topBand + i * bandGap;
    const dropX = 150 + (i + 1) * (300 / (rows + 1));
    p.edge(ent, sys, label, S.edgeFlow + 'exitX=0;exitY=0.25;exitDx=0;exitDy=0;entryX=' + (((dropX - 120) / 320).toFixed(3)) + ';entryY=0;entryDx=0;entryDy=0;',
      [[860, y], [dropX, y]]);
  });
  spec.outputs.forEach((label, j) => {
    const y = sysY + 24 + j * 30;
    p.edge(sys, ent, label, S.edgeFlow + 'exitX=1;exitY=' + (((24 + j * 30) / 110).toFixed(3)) + ';exitDx=0;exitDy=0;entryX=0;entryY=0.75;entryDx=0;entryDy=0;',
      [[520, y], [860, y]]);
  });
  return p;
}

const DFD0 = [
  { name: 'Super Admin',
    inputs: ['Login Credentials', 'Role Permission Details', 'Service and Pricing Details', 'Payment Channel Details', 'Clinic Schedule Details', 'Analytics Request Details'],
    outputs: ['Account Confirmed Details', 'Updated Permission Matrix', 'Updated Service Catalogue', 'System Analytics', 'Audit Trail Records'] },
  { name: 'Admin',
    inputs: ['Login Credentials', 'HMO Claim Decision', 'Staff Account Details', 'Patient Record Corrections', 'Report Request Details'],
    outputs: ['Account Confirmed Details', 'HMO Claim Requests', 'Patient Records', 'Report Details', 'Cashier Transaction Records'] },
  { name: 'Receptionist',
    inputs: ['Login Credentials', 'Walk-In Patient Registration', 'Scanned QR Code', 'Visit Test Request Details', 'HMO Claim Details', 'No-Show Details'],
    outputs: ['Account Confirmed Details', 'Verified Booking Details', 'Queue Ticket', 'Billing Request', 'HMO Claim Decision'] },
  { name: 'Cashier',
    inputs: ['Login Credentials', 'Billing and Payment Details', 'Statutory Discount Details', 'Proof of Payment Decision', 'Refund Details'],
    outputs: ['Account Confirmed Details', 'Patients Waiting to Pay', 'Receipt Details', 'Proof of Payment Submissions', 'Takings Summary'] },
  { name: 'Laboratory Staff',
    inputs: ['Login Credentials', 'Laboratory Result Details', 'Result Status Update', 'Critical Value Callback'],
    outputs: ['Account Confirmed Details', 'Laboratory Test Requests', 'Patient Details', 'Released Result Record'] },
  { name: 'Ultrasound Staff',
    inputs: ['Login Credentials', 'Ultrasound Measurements and Findings', 'Result Status Update', 'Critical Value Callback'],
    outputs: ['Account Confirmed Details', 'Ultrasound Test Requests', 'Patient Details', 'Released Result Record'] },
  { name: 'Xray Staff',
    inputs: ['Login Credentials', 'X-Ray Findings', 'Result Status Update', 'Critical Value Callback'],
    outputs: ['Account Confirmed Details', 'X-Ray Test Requests', 'Patient Details', 'Released Result Record'] },
  { name: 'Client Patient',
    inputs: ['Registration Details', 'Emailed Verification Code', 'Login Credentials', 'Patient Profile Details', 'Appointment Request Details', 'Proof of Payment'],
    outputs: ['Account Confirmed Details', 'QR Booking Pass and Reference', 'Preparation Instructions', 'Receipt Details', 'Diagnostic Results'] },
];

function dfd0Context() {
  const p = new Page('Context');
  const sys = p.node(SYSTEM_NAME.replace('\n', ' '), 560, 470, 360, 140, S.system);
  const left = ['Client / Patient', 'Receptionist', 'Cashier', 'Laboratory Staff'];
  const right = ['Ultrasound Staff', 'X-Ray Staff', 'Admin', 'Super Admin'];
  const labels = {
    'Client / Patient': 'bookings, payments, results',
    Receptionist: 'check-in, walk-ins, queue',
    Cashier: 'billing, receipts, takings',
    'Laboratory Staff': 'laboratory results',
    'Ultrasound Staff': 'ultrasound results',
    'X-Ray Staff': 'x-ray results',
    Admin: 'HMO decisions, reports',
    'Super Admin': 'access, services, schedule',
  };
  left.forEach((name, i) => {
    const e = p.node(name, 80, 120 + i * 220, 200, 80, S.entity);
    p.edge(e, sys, labels[name], S.edgeFlow + 'startArrow=classic;startFill=1;');
  });
  right.forEach((name, i) => {
    const e = p.node(name, 1200, 120 + i * 220, 200, 80, S.entity);
    p.edge(e, sys, labels[name], S.edgeFlow + 'startArrow=classic;startFill=1;');
  });
  return p;
}

// ── 4. DFD level 1 ──────────────────────────────────────────────────────────────────────────────
const STORES = {
  D1: 'User and Access Data', D2: 'Patient Data', D3: 'Appointment and Visit Data',
  D4: 'Payment Data', D5: 'Service Catalogue', D6: 'Diagnostic Result Data',
  D7: 'HMO Data', D8: 'Schedule Data', D9: 'System Log and Notification Data',
};

function dfd1(spec) {
  const p = new Page(spec.name);
  const procH = 100, gap = 70;
  const total = spec.processes.length * (procH + gap) - gap;
  const ent = p.node(spec.name, 60, 60 + total / 2 - 50, 200, 100, S.entity);
  const storeCells = {};

  spec.processes.forEach((proc, i) => {
    const y = 60 + i * (procH + gap);
    const lane = p.node(proc.n, 470, y, 260, procH, S.procHead);
    p.node(proc.name, 0, 24, 260, procH - 24, S.procBody, lane.id);
    (proc.in || []).forEach((label, k) => p.edge(ent, lane, label, S.edgeFlow + `exitX=1;exitY=${(0.3 + k * 0.25).toFixed(2)};exitDx=0;exitDy=0;entryX=0;entryY=${(0.3 + k * 0.3).toFixed(2)};entryDx=0;entryDy=0;`));
    (proc.out || []).forEach((label, k) => p.edge(lane, ent, label, S.edgeFlow + `exitX=0;exitY=${(0.7 - k * 0.25).toFixed(2)};exitDx=0;exitDy=0;entryX=1;entryY=${(0.7 - k * 0.2).toFixed(2)};entryDx=0;entryDy=0;`));
    (proc.stores || []).forEach((st, k) => {
      let store = storeCells[st.id];
      if (!store) {
        const sy = y + k * 80;
        const tag = p.node(st.id, 980, sy, 44, 56, S.storeTag);
        p.node(STORES[st.id], 1024, sy, 250, 56, S.storeName);
        store = tag;
        storeCells[st.id] = store;
      }
      // Separate the two directions, or the labels print on top of each other.
      if (st.to) p.edge(lane, store, st.to, S.edgeFlow + 'exitX=1;exitY=0.75;exitDx=0;exitDy=0;entryX=0;entryY=0.75;entryDx=0;entryDy=0;');
      if (st.from) p.edge(store, lane, st.from, S.edgeFlow + 'exitX=0;exitY=0.25;exitDx=0;exitDy=0;entryX=1;entryY=0.25;entryDx=0;entryDy=0;');
    });
  });
  return p;
}

const P = {
  login: { n: '1.0', name: 'Manage Login and Verification' },
  profiles: { n: '2.0', name: 'Manage Patient Profiles' },
  appts: { n: '3.0', name: 'Manage Appointments and Slots' },
  checkin: { n: '4.0', name: 'Check In and Issue Queue Ticket' },
  requests: { n: '5.0', name: 'Manage Visit Service Requests' },
  hmoRaise: { n: '6.0', name: 'Record HMO Claim' },
  hmoDecide: { n: '7.0', name: 'Decide HMO Claim' },
  billing: { n: '8.0', name: 'Process Billing and Payment' },
  proof: { n: '9.0', name: 'Review Online Payment Proof' },
  release: { n: '10.0', name: 'Release Visit to Departments' },
  results: { n: '11.0', name: 'Record Diagnostic Results' },
  deliver: { n: '12.0', name: 'Release and Deliver Results' },
  records: { n: '13.0', name: 'Manage Patient Records' },
  catalogue: { n: '14.0', name: 'Manage Services, Packages and Pricing' },
  schedule: { n: '15.0', name: 'Manage Clinic Schedule' },
  staff: { n: '16.0', name: 'Manage Staff Accounts' },
  rbac: { n: '17.0', name: 'Manage Roles and Permissions' },
  reports: { n: '18.0', name: 'Generate Reports and Analytics' },
  notify: { n: '19.0', name: 'Send Notifications and Emails' },
  audit: { n: '20.0', name: 'Record Audit Trail and Retention' },
};
const login = (entity) => ({ ...P.login, in: ['Login Credentials'], out: ['Account Confirmed Details'], stores: [{ id: 'D1', to: 'Verify Login Credentials', from: 'Verified Login Credentials' }] });

const DFD1 = [
  { name: 'Super Admin', processes: [
    login(), { ...P.rbac, in: ['Role Permission Details'], out: ['Updated Permission Matrix'], stores: [{ id: 'D1', to: 'Store Permission Changes' }] },
    { ...P.catalogue, in: ['Service and Pricing Details'], out: ['Updated Service Catalogue'], stores: [{ id: 'D5', to: 'Store Service Details', from: 'Service Records' }] },
    { ...P.schedule, in: ['Clinic Schedule Details'], out: ['Published Clinic Hours'], stores: [{ id: 'D8', to: 'Store Hours and Overrides' }] },
    { ...P.reports, in: ['Analytics Request Details'], out: ['System Analytics'], stores: [{ id: 'D4', from: 'Payment Records' }, { id: 'D3', from: 'Visit Records' }] },
    { ...P.audit, out: ['Audit Trail Records'], stores: [{ id: 'D9', from: 'Audit Entries' }] }] },
  { name: 'Admin', processes: [
    login(), { ...P.hmoDecide, in: ['HMO Claim Decision'], out: ['HMO Claim Requests'], stores: [{ id: 'D7', to: 'Store Decision and Reason', from: 'Pending Claims' }] },
    { ...P.staff, in: ['Staff Account Details'], out: ['Created Account Details'], stores: [{ id: 'D1', to: 'Store Staff Account' }] },
    { ...P.records, in: ['Patient Record Corrections'], out: ['Patient Records'], stores: [{ id: 'D2', to: 'Update Patient Record', from: 'Patient Details' }] },
    { ...P.reports, in: ['Report Request Details'], out: ['Report Details'], stores: [{ id: 'D4', from: 'Payment Records' }, { id: 'D3', from: 'Visit and Test Records' }] }] },
  { name: 'Receptionist', processes: [
    login(), { ...P.profiles, in: ['Walk-In Patient Registration'], out: ['Patient Record Created'], stores: [{ id: 'D2', to: 'Store Patient Details', from: 'Existing Patient Details' }] },
    { ...P.checkin, in: ['Scanned QR Code'], out: ['Queue Ticket'], stores: [{ id: 'D3', to: 'Stamp Arrival and Ticket', from: "Today's Bookings" }] },
    { ...P.requests, in: ['Visit Test Request Details'], out: ['Billing Request'], stores: [{ id: 'D3', to: 'Store Visit Tests' }, { id: 'D5', from: 'Service and Package Details' }] },
    { ...P.hmoRaise, in: ['HMO Claim Details'], out: ['Claim Raised for Decision'], stores: [{ id: 'D7', to: 'Store Claim and Card Evidence' }] }] },
  { name: 'Cashier', processes: [
    login(), { ...P.billing, in: ['Billing and Payment Details'], out: ['Receipt Details'], stores: [{ id: 'D4', to: 'Store Payment and Receipt', from: 'Discount Types' }, { id: 'D3', from: 'Visit Tests and Prices' }] },
    { ...P.proof, in: ['Proof of Payment Decision'], out: ['Proof of Payment Submissions'], stores: [{ id: 'D4', to: 'Store Verification Outcome', from: 'Uploaded Proofs' }] },
    { ...P.release, out: ['Ticket Sent to the Department'], stores: [{ id: 'D3', to: 'Set Visit to Processing' }] },
    { ...P.reports, in: ['Date Range'], out: ['Takings Summary'], stores: [{ id: 'D4', from: 'Settled and Reversed Payments' }] }] },
  ...['Laboratory', 'Ultrasound', 'Xray'].map((dept) => ({
    name: `${dept} Staff`, processes: [
      login(),
      { ...P.results, in: [`${dept === 'Xray' ? 'X-Ray' : dept} Result Details`], out: ['Test Requests for the Department'], stores: [{ id: 'D6', to: 'Store Result Version and Measurements', from: 'Result Form Fields' }, { id: 'D3', from: 'Released Visit Tests' }] },
      { ...P.deliver, in: ['Result Status Update'], out: ['Released Result Record'], stores: [{ id: 'D6', to: 'Record Release and Delivery' }] },
      { ...P.notify, out: ['Result Emailed to the Patient'], stores: [{ id: 'D9', to: 'Store Notification Event' }] }],
  })),
  { name: 'Client Patient', processes: [
    { ...P.login, in: ['Registration Details', 'Login Credentials'], out: ['Emailed Verification Code', 'Account Confirmed Details'], stores: [{ id: 'D1', to: 'Store Account and Code', from: 'Verified Credentials' }] },
    { ...P.profiles, in: ['Patient Profile Details'], out: ['Saved Patient Profiles'], stores: [{ id: 'D2', to: 'Store Patient Profile', from: 'Profile Details' }] },
    { ...P.appts, in: ['Appointment Request Details'], out: ['QR Booking Pass and Reference'], stores: [{ id: 'D3', to: 'Store Visit and Appointment', from: 'Available Slots' }, { id: 'D8', from: 'Clinic Hours and Overrides' }] },
    { ...P.proof, in: ['Proof of Payment'], out: ['Receipt Details'], stores: [{ id: 'D4', to: 'Store Payment Submission' }] },
    { ...P.deliver, out: ['Diagnostic Results'], stores: [{ id: 'D6', from: 'Released Results' }] }] },
];

// ── 5. ERD, read from the live database ─────────────────────────────────────────────────────────
const SHEETS = [
  { name: 'Clinical Core', tables: ['patients', 'patient_types', 'patient_visits', 'appointments', 'visit_tests', 'tests', 'test_categories', 'test_packages', 'test_package_items', 'test_results', 'result_field_sets', 'result_fields', 'result_field_set_tests', 'result_measurements', 'clinic_signatories'] },
  { name: 'Money and HMO', tables: ['payments', 'payment_methods', 'payment_submissions', 'discount_types', 'daily_counters', 'hmo_providers', 'hmo_requests', 'hmo_request_tests'] },
  { name: 'Access Schedule and System', tables: ['users', 'roles', 'permissions', 'role_permissions', 'user_roles', 'user_permissions', 'user_departments', 'auth_codes', 'clinic_operating_hours', 'clinic_schedule_overrides', 'audit_log', 'notification_events', 'notification_reads'] },
];

function pgType(c) {
  const t = c.data_type;
  if (c.column_default && /nextval/.test(c.column_default)) return 'SERIAL';
  if (t === 'character varying') return `VARCHAR(${c.character_maximum_length || ''})`;
  if (t === 'numeric') return c.numeric_precision ? `NUMERIC(${c.numeric_precision},${c.numeric_scale})` : 'NUMERIC';
  if (t === 'timestamp without time zone') return 'TIMESTAMP';
  if (t === 'timestamp with time zone') return 'TIMESTAMPTZ';
  if (t === 'time without time zone') return 'TIME';
  if (t === 'character') return `CHAR(${c.character_maximum_length || ''})`;
  if (t === 'USER-DEFINED') return 'ENUM';
  return t.toUpperCase();
}

function erdSheet(sheet, schema) {
  const p = new Page(sheet.name);
  const { columns, pks, fks } = schema;
  const onSheet = new Set(sheet.tables);
  const placed = {};
  const COL_X = [60, 460, 860, 1260];
  const colBottom = [60, 60, 60, 60];
  const ROW_H = 22, HEAD = 28;

  const rowIds = {};
  const order = sheet.tables.slice().sort((a, b) => (columns[b] || []).length - (columns[a] || []).length);
  order.forEach((tbl) => {
    const cols = columns[tbl] || [];
    const h = HEAD + cols.length * ROW_H;
    let ci = 0;
    for (let i = 1; i < COL_X.length; i += 1) if (colBottom[i] < colBottom[ci]) ci = i;
    const x = COL_X[ci], y = colBottom[ci];
    colBottom[ci] = y + h + 40;
    const table = p.node(tbl, x, y, 360, h, S.table);
    placed[tbl] = table;
    rowIds[tbl] = {};
    cols.forEach((c, ri) => {
      const row = p.node('', 0, HEAD + ri * ROW_H, 360, ROW_H, S.tableRow, table.id);
      rowIds[tbl][c.column_name] = row;
      const isPk = (pks[tbl] || []).includes(c.column_name);
      const isFk = (fks[tbl] || []).some((f) => f.column === c.column_name);
      const key = isPk ? 'PK' : isFk ? 'FK' : '';
      p.node(key, 0, 0, 34, ROW_H, S.tableCell + 'align=center;fontStyle=1;', row.id);
      p.node(c.column_name, 34, 0, 190, ROW_H, S.tableCell + (isPk ? 'fontStyle=1;' : ''), row.id);
      p.node(pgType(c) + (c.is_nullable === 'NO' ? '' : ' ?'), 224, 0, 136, ROW_H, S.tableCell + 'fontColor=#5A6B7B;', row.id);
    });
  });

  // Foreign keys inside the sheet; a parent on another sheet is drawn as a faint ghost.
  const ghosts = {};
  sheet.tables.forEach((tbl) => {
    (fks[tbl] || []).forEach((f) => {
      let target = placed[f.parent];
      if (!target) {
        if (!ghosts[f.parent]) {
          let ci = 0;
          for (let i = 1; i < COL_X.length; i += 1) if (colBottom[i] < colBottom[ci]) ci = i;
          ghosts[f.parent] = p.node(`${f.parent}\n(see the other sheet)`, COL_X[ci], colBottom[ci], 360, 54, S.tableGhost);
          colBottom[ci] += 94;
        }
        target = ghosts[f.parent];
      } else {
        // Point at the parent's own key row, the way Workbench draws it.
        const pk = (pks[f.parent] || [])[0];
        if (pk && rowIds[f.parent] && rowIds[f.parent][pk]) target = rowIds[f.parent][pk];
      }
      // The line starts at the foreign-key row itself, so it needs no label.
      const source = (rowIds[tbl] && rowIds[tbl][f.column]) || placed[tbl];
      p.edge(source, target, '', S.erEdge);
    });
  });

  p.node(`Figure note: ${sheet.name} — ${sheet.tables.length} tables. Types are PostgreSQL. "?" marks a nullable column. PK is the primary key, FK a foreign key.`,
    60, Math.max(...colBottom) + 20, 700, 60, S.note);
  return p;
}

async function readSchema() {
  require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
  const db = require(path.join(BACKEND, 'src', 'config', 'database'));
  const cols = await db.query(
    `SELECT table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale,
            is_nullable, column_default, ordinal_position
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`
  );
  const keys = await db.query(
    `SELECT con.contype, src.relname AS child, tgt.relname AS parent, a.attname AS column
       FROM pg_constraint con
       JOIN pg_class src ON src.oid = con.conrelid
       LEFT JOIN pg_class tgt ON tgt.oid = con.confrelid
       JOIN unnest(con.conkey) AS k(attnum) ON TRUE
       JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = k.attnum
       JOIN pg_namespace n ON n.oid = src.relnamespace
      WHERE n.nspname = 'public' AND con.contype IN ('p', 'f')`
  );
  const columns = {}, pks = {}, fks = {};
  cols.rows.forEach((c) => { (columns[c.table_name] ||= []).push(c); });
  keys.rows.forEach((k) => {
    if (k.contype === 'p') (pks[k.child] ||= []).push(k.column);
    else (fks[k.child] ||= []).push({ column: k.column, parent: k.parent });
  });
  return { columns, pks, fks };
}

// ── Build ───────────────────────────────────────────────────────────────────────────────────────
(async () => {
  writeFile('flowcharts.drawio', [
    flowchart(SUPER_ADMIN_FLOW), flowchart(ADMIN_FLOW), flowchart(RECEPTIONIST_FLOW), flowchart(CASHIER_FLOW),
    flowchart(departmentFlow('Laboratory', 'Enter the result on the clinic laboratory form: analytes, units and reference ranges')),
    flowchart(departmentFlow('Ultrasound', 'Enter the measurements, findings and impression')),
    flowchart(departmentFlow('X-Ray', 'Enter the findings and impression')),
    flowchart(CLIENT_FLOW),
  ]);
  writeFile('usecases.drawio', USE_CASES.map(useCase));
  writeFile('dfd-level0.drawio', [dfd0Context(), ...DFD0.map(dfd0)]);
  writeFile('dfd-level1.drawio', DFD1.map(dfd1));

  const schema = await readSchema();
  writeFile('erd.drawio', SHEETS.map((s) => erdSheet(s, schema)));
  const total = Object.keys(schema.columns).length;
  const drawn = SHEETS.reduce((n, s) => n + s.tables.length, 0);
  console.log(`ERD: ${drawn} of ${total} tables drawn across ${SHEETS.length} sheets`);
  if (drawn !== total) {
    const missing = Object.keys(schema.columns).filter((t) => !SHEETS.some((s) => s.tables.includes(t)));
    console.log(`MISSING from the sheets: ${missing.join(', ')}`);
  }
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
