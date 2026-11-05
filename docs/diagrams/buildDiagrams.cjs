/**
 * Builds the capstone paper's diagrams as draw.io files, in the same style as the originals.
 *
 * The flowcharts, use cases and data flow diagrams are laid out from the specs below; the ERD is
 * read from the live database, so it cannot drift from the schema. Run from anywhere:
 *
 *   node docs/diagrams/buildDiagrams.cjs
 *
 * Output: one .drawio file per group, each with a tab per figure. Open in draw.io to adjust the
 * placement by hand — the layout here is deliberately roomy so boxes can be dragged without
 * crossing lines. Export with exportPng.ps1 beside this file.
 */
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const BACKEND = path.join(__dirname, '..', '..', 'backend');

// ── draw.io plumbing ────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Black ink on white, like a printed figure. Nothing in these diagrams uses colour to mean
// anything, so colour only costs the reader contrast on a photocopy or a projector.
const FONT = 'fontFamily=Helvetica;fontSize=14;fontColor=#000000;strokeColor=#000000;';
const SMALL = 'fontFamily=Helvetica;fontSize=12;fontColor=#000000;strokeColor=#000000;';
const S = {
  actor: 'shape=actor;fillColor=none;strokeColor=#000000;html=1;verticalLabelPosition=top;verticalAlign=bottom;fontFamily=Helvetica;fontSize=14;fontColor=#000000;fontStyle=1',
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
  // The actor's line to a use case. Strict UML draws it plain; Steven wants the arrowhead.
  edgeStraight: 'edgeStyle=none;rounded=0;html=1;endArrow=classic;' + SMALL,
  edgeFlow: 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;verticalAlign=bottom;' + SMALL,
  edgeDashed: 'endArrow=open;endSize=12;dashed=1;html=1;' + SMALL,
  table: 'shape=table;startSize=30;container=1;collapsible=0;childLayout=tableLayout;fixedRows=1;rowLines=0;fontStyle=1;align=center;resizeLast=1;html=1;fillColor=none;strokeColor=#000000;fontColor=#000000;fontFamily=Helvetica;fontSize=14;',
  tableGhost: 'shape=table;startSize=30;container=1;collapsible=0;childLayout=tableLayout;fixedRows=1;rowLines=0;fontStyle=2;align=center;resizeLast=1;html=1;fillColor=none;strokeColor=#000000;dashed=1;fontColor=#000000;fontFamily=Helvetica;fontSize=14;',
  tableRow: 'shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=none;collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;top=0;left=0;right=0;bottom=0;',
  tableCell: 'shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;align=left;spacingLeft=6;overflow=hidden;html=1;fontFamily=Helvetica;fontSize=12;fontColor=#000000;',
  erEdge: 'edgeStyle=entityRelationEdgeStyle;fontSize=12;html=1;endArrow=ERmandOne;startArrow=ERmany;rounded=0;strokeColor=#000000;',
  note: 'shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;fillColor=none;strokeColor=#000000;align=left;spacingLeft=6;' + SMALL,
};

class Page {
  constructor(name) { this.name = name; this.cells = []; this.n = 0; }
  id(prefix = 'n') { this.n += 1; return `${prefix}${this.n}`; }
  node(value, x, y, w, h, style, parent = '1') {
    const id = this.id();
    this.cells.push(`<mxCell id="${id}" value="${esc(value)}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" /></mxCell>`);
    return { id, x, y, w, h };
  }
  // labelX slides the label along the edge (-1 at the source, 1 at the target), which is what keeps
  // two flows between the same pair of boxes from printing their labels on top of each other.
  edge(from, to, label = '', style = S.edge, points = [], labelX = null) {
    const id = this.id('e');
    // A number slides the label along the path. An {at, dx, dy} pins it to one END of the path and
    // offsets it in pixels, which is the only way to put a label in the same place on every flow
    // when the paths are wildly different lengths — see dfd1.
    const pinned = labelX !== null && typeof labelX === 'object';
    const pos = labelX === null ? 'relative="1"' : `relative="1" x="${pinned ? labelX.at : labelX}"`;
    const inner = (points.length ? `<Array as="points">${points.map((p) => `<mxPoint x="${p[0]}" y="${p[1]}" />`).join('')}</Array>` : '')
      + (pinned ? `<mxPoint x="${labelX.dx}" y="${labelX.dy}" as="offset" />` : '');
    const geo = inner
      ? `<mxGeometry ${pos} as="geometry">${inner}</mxGeometry>`
      : `<mxGeometry ${pos} as="geometry" />`;
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
const NODE_W = 240, NODE_H = 66, DEC_H = 88, V_GAP = 50, SIDE_W = 215, COL_GAP = 52;

function kindStyle(k) {
  return k === 'dec' ? S.dec : k === 'io' ? S.io : k === 'term' ? S.term : S.proc;
}

// What a refused login leads to, the same on every chart: try again, or reset by emailed code. Both
// return to Login with a line and an arrowhead of their own [1.135.0]: the retry into its left, the
// reset round the outside and into its top, clear of the arrow arriving at the top's centre.
const FORGOT_W = 170, FORGOT_GAP = 60, FORGOT_LANE = 24;
const FORGOT_REACH = FORGOT_W + FORGOT_GAP + FORGOT_LANE;

function forgotPasswordLoop(p, login, gate, loginStyle) {
  const midY = gate.y + gate.h / 2;
  const x = gate.x - FORGOT_GAP - FORGOT_W;
  const asked = p.node('Forgot Password?', x, midY - 40, FORGOT_W, 80, S.dec);
  const reset = p.node('Reset password with emailed code', x, midY + 76, FORGOT_W, NODE_H, S.proc);
  p.edge(gate, asked, 'no', S.edge + 'exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;');
  p.edge(asked, login, 'no', S.edge + 'exitX=0.5;exitY=0;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;',
    [[x + FORGOT_W / 2, login.y + login.h / 2]]);
  p.edge(asked, reset, 'yes', S.edge + 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;');
  // A fifth of the way along Login's top. On an ellipse the top is lower there, so the end is fixed
  // on the curve itself, as End's entries are.
  const entryX = 0.2;
  const entryY = loginStyle === S.term ? (1 - Math.sqrt(1 - (2 * entryX - 1) ** 2)) / 2 : 0;
  const laneY = login.y - 22;
  p.edge(reset, login, '', `${S.edge}exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=${entryX};entryY=${entryY.toFixed(4)};entryDx=0;entryDy=0;entryPerimeter=0;`,
    [[x - FORGOT_LANE, reset.y + reset.h / 2], [x - FORGOT_LANE, laneY], [login.x + entryX * login.w, laneY]]);
}

function flowchart(spec) {
  const p = new Page(spec.name);
  const columns = spec.columns;
  // Column x positions: a column is wider when one of its steps has a side branch. A chart with
  // its login inside the first column starts further right, because the loop sits to its left.
  // Several branches ending in one column each take a lane to its right, and the column makes room.
  const endLanes = (col) => col.filter((s) => s.side && s.side.toEnd === true).length;
  const widths = columns.map((col) => NODE_W + (col.some((s) => s.side) ? SIDE_W + 36 : 0)
    + Math.max(0, endLanes(col) - 1) * 20);
  const left =columns[0].some((s) => s.forgot) ? 60 + FORGOT_REACH : 60;
  // A chained chart with a branch that ends early needs room for that line's lane beside the link
  // into the next column, or the two run 4px apart.
  const gap = spec.colGap || COL_GAP;
  const xs = [];
  let x = left;
  widths.forEach((w) => { xs.push(x); x += w + gap; });
  const totalW = x - gap - left;

  // The paper's own header, which Steven asked for: the actor, Login, the access check and the
  // landing screen in ONE centred stack above the columns, with the no branch going left to the
  // forgot password loop. The columns then fan out from the landing screen below it.
  //
  // Centred over the whole block, except on a chained chart, where the sequence starts at the
  // first column and the header belongs over that one — a fan that reached left across the other
  // columns would cross the link corridor that carries the chain.
  const headX = spec.chain ? xs[0] + NODE_W / 2 : left + totalW / 2;
  p.node(spec.actor, headX - 15, 44, 30, 50, S.actor);
  const start = p.node(spec.start || 'Login', headX - 75, 118, 150, 44, S.term);
  let landing;
  if (spec.gate === false) {
    landing = p.node(spec.landing, headX - NODE_W / 2, 196, NODE_W, NODE_H, S.proc);
    p.edge(start, landing);
  } else {
    const gate = p.node('Access Granted?', headX - 85, 194, 170, 80, S.dec);
    landing = p.node(spec.landing, headX - NODE_W / 2, 310, NODE_W, NODE_H, S.proc);
    p.edge(start, gate);
    p.edge(gate, landing, 'yes');
    forgotPasswordLoop(p, start, gate, S.term);
  }

  const topY = 440;
  let lowest = topY;
  const lastOfColumn = [];
  const firstOfColumn = [];
  const merges = [];
  columns.forEach((col, ci) => {
    const cx = xs[ci];
    // The lowest branch takes the nearest lane. Numbered the other way round, a lower box's line ran
    // out across the lanes of every box above it, and a crossing reads as a join.
    let endLane = endLanes(col);
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
      if (step.forgot) forgotPasswordLoop(p, main[si - 1].cell, at.cell, S.proc);
      // `chain` means the columns are one sequence wrapped into columns, not a menu of parallel
      // branches: the client's story runs book, confirm, pay, collect, and drawing those four as
      // independent branches off the landing screen says the patient does them all at once.
      if (si === 0) {
        if (spec.chain && ci > 0) firstOfColumn[ci] = at.cell;   // linked below, over the top
        else {
          // Down out of the landing screen onto one shared bus, then across and down into each
          // column — the comb the paper's figures draw. Left to its own devices draw.io takes the
          // nearest edge of the landing box, so one branch left its left side, one its bottom and
          // one its right, which reads as three different kinds of thing.
          const busY = landing.y + landing.h + 34;
          p.edge(landing, at.cell, '', S.edge + 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;',
            [[landing.x + landing.w / 2, busY], [cx + NODE_W / 2, busY]]);
        }
      } else p.edge(main[si - 1].cell, at.cell, col[si - 1].k === 'dec' ? (col[si - 1].mainLabel || 'yes') : '');
      if (step.side) {
        const side = p.node(step.side.l, cx + NODE_W + 36, at.y + (at.h - NODE_H) / 2, SIDE_W, NODE_H, kindStyle(step.side.k || 'proc'));
        p.edge(at.cell, side, step.side.label || 'yes');
        const rejoin = main[si + (step.side.mergeTo || 1)];
        if (step.side.back) {
          p.edge(side, at.cell, '', S.edge, [[cx + NODE_W + 36 + SIDE_W / 2, at.y - 26], [cx + NODE_W / 2, at.y - 26]]);
        } else if (step.side.toEnd === 'down') {
          // A branch that finishes here and drops STRAIGHT DOWN to the corridor. Asked for, never
          // assumed: it is only clear when no side box sits below it in its column. On a chained
          // chart the lane to the right would run beside the link into the next column, 4px away.
          merges.push({ cell: side, down: true });
        } else if (step.side.toEnd || !rejoin) {
          // A branch that finishes here, e.g. a refusal. It leaves to the RIGHT and drops in a
          // lane of its own: straight down out of the box, which is the obvious route, runs the
          // line through every side box below it in the same column — the Desk's no-show branch
          // crossed three of them.
          endLane = Math.max(0, endLane - 1);
          merges.push({ cell: side, lane: cx + NODE_W + 36 + SIDE_W + 22 + endLane * 20 });
        } else {
          // Down the side column, across the gap above the step it rejoins, and into its TOP.
          //
          // Entering from the RIGHT instead, which is the obvious way to draw it, put the line on
          // top of two other things: it cut through the box between the branch and its target, and
          // where the target was a decision it arrived at the very vertex that decision's own
          // branch leaves from, so one arrowhead appeared to point into the diamond and out of it.
          //
          // Beside the main path's arrow, with an arrowhead of its own [1.135.0]. It used to join
          // the main path's line above the target and share its arrow, so the branch's line and
          // the decision's "no" label met on one segment and the figure could not say which came
          // from where. No entry point is fixed: draw.io drops the line straight onto the target's
          // outline below the last waypoint, which on a diamond is its upper-right edge.
          const laneY = rejoin.y - 26;
          const enterX = cx + NODE_W * (col[si + (step.side.mergeTo || 1)].k === 'dec' ? 0.64 : 0.76);
          p.edge(side, rejoin.cell, '', S.edge + 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;',
            [[cx + NODE_W + 36 + SIDE_W / 2, laneY], [enterX, laneY]]);
        }
      }
    });
    lastOfColumn.push(main[main.length - 1].cell);
  });

  // Every column ends at the one End. Drop straight down to a clear corridor below the columns
  // first, then run across: routed along their own row instead, the lines cut through the boxes
  // of every column to their right.
  // A chained chart snakes: leave the last step sideways into the gap between columns, climb to a
  // corridor above the column tops, then drop into the next column. Routed directly, the link
  // climbs straight through every box of the column it is heading for.
  if (spec.chain) {
    const linkY = topY - 34;
    for (let ci = 1; ci < columns.length; ci += 1) {
      const prev = lastOfColumn[ci - 1];
      const next = firstOfColumn[ci];
      if (!prev || !next) continue;
      const gapX = xs[ci] - gap / 2;
      p.edge(prev, next, '', S.edge + 'exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;',
        [[gapX, prev.y + prev.h / 2], [gapX, linkY], [next.x + next.w / 2, linkY]]);
    }
  }

  // Every line into End has its own arrowhead and its own lane [1.135.0]. Steven: they all met on
  // one corridor and entered End as a single arrow, so a figure could not say which box led where,
  // and on a projector a shared line reads as boxes connected to each other.
  //
  // Each line gets an entry point of its own along End's top, in the order the lines arrive from
  // left to right. Its lane nests the way the Level 0 DFD's corridors do: of the lines coming in
  // from the left, the one furthest out runs lowest and lands furthest left, mirrored on the right,
  // so no two lines cross. A line already over its entry point drops straight in. Each line's end is
  // fixed on the ellipse itself (entryPerimeter=0 at the curve's own height for that x): left to
  // draw.io, a line that dropped straight down was turned along to End's centre, because its
  // router alternates vertical and horizontal segments, and landed on another line's arrowhead.
  //
  // In a chained chart only the final column reaches End; the others continue into the next column.
  const LANE_GAP = 18, ENTRY_GAP = 30;
  const laneTop = lowest + 14;
  const finishers = spec.chain ? [lastOfColumn[lastOfColumn.length - 1]] : lastOfColumn;
  const into = [
    ...finishers.map((cell) => ({ cell, x: cell.x + cell.w / 2, from: 'bottom' })),
    // A `down` branch on a chained chart has to cross the link into the next column (the link
    // closes the side column off below); the arc hop says the two only pass.
    ...merges.map((m) => (m.down
      ? { cell: m.cell, x: m.cell.x + m.cell.w / 2, from: 'bottom', hop: true }
      : { cell: m.cell, x: m.lane, from: 'side', hop: spec.chain })),
  ].sort((a, b) => a.x - b.x);
  const endCx = left + totalW / 2;
  const span = (into.length - 1) * ENTRY_GAP;
  into.forEach((l, i) => { l.entry = endCx - span / 2 + i * ENTRY_GAP; });
  // Slide the whole row of entries, by up to half a gap, so the line nearest one drops straight in:
  // the Cashier's middle column otherwise made a 15px jog just above End.
  const nearest = into.reduce((a, b) => (Math.abs(b.x - b.entry) < Math.abs(a.x - a.entry) ? b : a));
  const slide = nearest.x - nearest.entry;
  if (Math.abs(slide) <= ENTRY_GAP / 2) into.forEach((l) => { l.entry += slide; });
  // Nearly over its entry point: take the line's own x rather than jog a few pixels, as long as it
  // stays 16px clear of its neighbours' entries.
  into.forEach((l, i) => {
    if (Math.abs(l.x - l.entry) >= 12) return;
    const prev = into[i - 1], next = into[i + 1];
    if ((!prev || l.x - prev.entry >= 16) && (!next || next.entry - l.x >= 16)) l.entry = l.x;
  });
  const fromLeft = into.filter((l) => l.x < l.entry).sort((a, b) => b.x - a.x);
  const fromRight = into.filter((l) => l.x > l.entry).sort((a, b) => a.x - b.x);
  fromLeft.forEach((l, k) => { l.depth = k; });
  fromRight.forEach((l, k) => { l.depth = k; });
  const depth = Math.max(fromLeft.length, fromRight.length);
  const endY = laneTop + depth * LANE_GAP + 10;
  const endW = Math.max(120, span + 100);
  const end = p.node('End', endCx - endW / 2, endY, endW, 44, S.term);
  into.forEach((l) => {
    const exit = l.from === 'side' ? 'exitX=1;exitY=0.5;exitDx=0;exitDy=0;' : 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;';
    const u = (l.entry - endCx) / (endW / 2);
    const onCurve = (1 - Math.sqrt(Math.max(0, 1 - u * u))) / 2;
    const entry = `entryX=${((l.entry - (endCx - endW / 2)) / endW).toFixed(4)};entryY=${onCurve.toFixed(4)};entryDx=0;entryDy=0;entryPerimeter=0;`;
    const style = S.edge + exit + entry + (l.hop ? 'jumpStyle=arc;jumpSize=12;' : '');
    const out = l.from === 'side' ? [[l.x, l.cell.y + l.cell.h / 2]] : [];
    const y = laneTop + (l.depth || 0) * LANE_GAP;
    const route = l.entry === l.x ? [[l.x, laneTop]] : [[l.x, y], [l.entry, y]];
    p.edge(l.cell, end, '', style, [...out, ...route]);
  });
  return p;
}

// A Super Admin also reaches every Admin screen; this chart draws what only they do, plus the
// screens they run. A refund is theirs by role, never on a receipt they took themselves [1.155.0].
const SUPER_ADMIN_FLOW = {
  name: 'Super Admin', actor: 'Super Admin', landing: 'Today',
  columns: [
    [{ k: 'proc', l: 'Who Sees What' }, { k: 'proc', l: 'Edit role access' }, { k: 'proc', l: 'Review changes and save' }],
    [{ k: 'proc', l: 'One Person' }, { k: 'proc', l: 'Grant or revoke access' }, { k: 'proc', l: 'Change is audited' }],
    [{ k: 'proc', l: 'Staff and Elevated Accounts' }, { k: 'proc', l: 'Add or deactivate accounts' }],
    [{ k: 'proc', l: 'Services Catalog' }, { k: 'proc', l: 'Edit tests, prices and packages' }],
    [{ k: 'proc', l: 'Payment Methods' }, { k: 'proc', l: 'Publish GCash and QR' }, { k: 'proc', l: 'Set one or per-cashier drawer' }],
    [{ k: 'proc', l: 'Transaction History' }, { k: 'proc', l: 'Open a receipt' }, { k: 'proc', l: 'Refund: pick case and tests' },
      { k: 'proc', l: 'Record reason and money back' }, { k: 'proc', l: 'Patient emailed, receipt marked' }],
    [{ k: 'proc', l: 'Clinic Schedule' }, { k: 'proc', l: 'Set hours and closures' }, { k: 'proc', l: 'Affected patients emailed' }],
    [{ k: 'proc', l: 'Reports' }, { k: 'proc', l: 'Generate report' }, { k: 'io', l: 'Print A4 or export Excel' }],
    [{ k: 'proc', l: 'Patient Feedback' }, { k: 'proc', l: 'Manage survey questions' }, { k: 'proc', l: 'Review visit feedback' }],
    [{ k: 'proc', l: 'Activity Log' }, { k: 'proc', l: 'Review audit trail' }],
  ],
};

// A package part-covered by an HMO goes back to each test's own price [1.159.0], whichever way the
// lines were decided, so the check comes after both branches have rejoined.
const ADMIN_FLOW = {
  name: 'Admin', actor: 'Admin', landing: 'Today',
  columns: [
    [{ k: 'proc', l: 'Service Requests' }, { k: 'proc', l: 'Open HMO claim and deadline' },
      { k: 'dec', l: 'Approve the claim?', mainLabel: 'yes',
        side: { l: 'Record refusal reason', label: 'no', mergeTo: 2 } },
      { k: 'proc', l: 'Record approval code' },
      { k: 'dec', l: 'Only part of a package covered?', mainLabel: 'no',
        side: { l: 'Tests back to own prices', label: 'yes' } },
      { k: 'proc', l: 'Notify cashier and patient' }],
    [{ k: 'proc', l: 'Appointments' }, { k: 'proc', l: 'View bookings and moves' }],
    [{ k: 'proc', l: 'Patient Records' }, { k: 'proc', l: 'Search, correct or archive' }, { k: 'proc', l: 'Invite or unlink portal access' }, { k: 'io', l: 'View or print a report' }],
    [{ k: 'proc', l: 'Cashier Monitoring' }, { k: 'proc', l: 'Review takings and cash counts' }],
    [{ k: 'proc', l: 'Staff Accounts' }, { k: 'proc', l: 'Add or update staff' }],
    [{ k: 'proc', l: 'Services Catalog' }, { k: 'proc', l: 'Edit tests, prices and packages' }],
    [{ k: 'proc', l: 'Clinic Schedule' }, { k: 'proc', l: 'Set hours and closures' }, { k: 'proc', l: 'Affected patients emailed' }],
    [{ k: 'proc', l: 'Reports' }, { k: 'proc', l: 'Generate report' }, { k: 'io', l: 'Print A4 or export Excel' }],
    [{ k: 'proc', l: 'Patient Feedback' }, { k: 'proc', l: 'Manage survey questions' }, { k: 'proc', l: 'Review visit feedback' }],
    [{ k: 'proc', l: 'Activity Log' }, { k: 'proc', l: 'Review audit trail' }],
  ],
};

// One pass through the desk, not three.
//
// The Desk is ONE screen: a box that takes a name, a reference or a scan, and the answer decides
// whether the next click is Reschedule, Check in or Start a walk-in visit. Unpaid bookings and
// visits expire automatically on a timer rather than being marked no-show by hand.
//
// The tests come BEFORE the ticket [1.129.0]: a visit is opened with its tests, and Confirm
// Check-In waits for one. And only a PAYMENT sends a visit to its department
// (visitService.releaseVisitIfReady): an HMO patient still goes to the till, whose receipt covers
// the patient's share, ₱0 when the HMO approved everything.
const RECEPTIONIST_FLOW = {
  name: 'Receptionist', actor: 'Receptionist', landing: 'Today',
  columns: [
    [{ k: 'proc', l: 'Desk' },
      { k: 'proc', l: 'Search name, reference or QR' },
      { k: 'dec', l: 'Reschedule a booking?', mainLabel: 'no',
        side: { l: 'Move to new date and time', label: 'yes', toEnd: true } },
      { k: 'dec', l: 'Booking for today?', mainLabel: 'yes',
        side: { l: 'Pick tests, start walk-in visit', label: 'no', mergeTo: 2 } },
      { k: 'proc', l: 'Confirm tests, check in' },
      { k: 'io', l: 'Issue queue ticket' },
      // Until a department has started [1.156.0]: the ticket goes, and the booking returns to its date.
      { k: 'dec', l: 'Checked in by mistake?', mainLabel: 'no',
        side: { l: 'Undo check-in with a reason', label: 'yes', toEnd: true } },
      { k: 'dec', l: 'HMO patient?', mainLabel: 'no',
        side: { l: 'Record card, send to Admin', label: 'yes' } },
      { k: 'dec', l: 'Already paid?', mainLabel: 'no',
        side: { l: 'Visit goes to department', label: 'yes', toEnd: true } },
      { k: 'proc', l: 'Send patient to the cashier' }],
    [{ k: 'proc', l: 'Patient Records' },
      { k: 'proc', l: 'Open patient file' },
      { k: 'proc', l: 'Invite patient to the portal' }],
    [{ k: 'proc', l: 'Visit History' },
      { k: 'proc', l: 'Review past visits' },
      { k: 'proc', l: 'Record paper feedback' }],
  ],
};

// The till: one bill, one receipt, online payment proof verification, and the day's cash count.
// Before payment is taken, the cashier confirms the final list of tests with the patient. A pending
// HMO decision stops the till unless the claim is withdrawn and the bill charged in full [1.123.0].
const CASHIER_FLOW = {
  name: 'Cashier', actor: 'Cashier', landing: 'Today',
  columns: [
    [{ k: 'proc', l: 'Billing Queue' },
      { k: 'proc', l: 'Select patient to bill' },
      { k: 'proc', l: 'System computes the bill' },
      { k: 'dec', l: 'HMO decision pending?', mainLabel: 'no',
        side: { l: 'Wait, or withdraw the claim', label: 'yes' } },
      { k: 'dec', l: 'Senior or PWD ID?', mainLabel: 'no',
        side: { l: 'Apply 20% discount', label: 'yes' } },
      { k: 'proc', l: 'Confirm final tests' },
      { k: 'proc', l: 'Take payment and change' },
      { k: 'io', l: 'Issue and print receipt' },
      { k: 'proc', l: 'Visit goes to department' }],
    [{ k: 'proc', l: 'Online Payments' },
      { k: 'proc', l: 'Open proof of payment' },
      { k: 'dec', l: 'Proof matches the bill?', mainLabel: 'yes',
        side: { l: 'Reject and email patient', label: 'no', toEnd: true } },
      { k: 'proc', l: 'Approve: receipt issued' }],
    [{ k: 'proc', l: 'Transaction History' },
      { k: 'proc', l: 'Pick date range' },
      { k: 'proc', l: 'View takings and receipts' },
      { k: 'io', l: 'Print receipt copy' }],
    // [1.150.0] The server adds it up, and a difference needs a note.
    [{ k: 'proc', l: 'Cash Count' },
      { k: 'proc', l: 'Enter change fund and count' },
      { k: 'dec', l: 'Matches expected cash?', mainLabel: 'yes',
        side: { l: 'Write a note on the difference', label: 'no' } },
      { k: 'proc', l: 'Save the count' },
      { k: 'io', l: 'Print count sheet' }],
    [{ k: 'proc', l: 'Patient Records' },
      { k: 'proc', l: 'Open patient file' }],
  ],
};

// A result IS the report file the department produces; nothing is retyped into the website.
// Save for Later parks the ticket in 'Waiting for Release', and Authorise & Release puts a
// digital copy in the patient's portal; emailing is an optional step after release or from History.
function departmentFlow(dept, formStep) {
  return {
    name: dept, actor: `${dept} Staff`, landing: 'Today',
    columns: [
      [{ k: 'proc', l: `${dept} Worklist` },
        { k: 'proc', l: 'Open a released ticket' },
        { k: 'proc', l: 'Perform the test' },
        // [1.163.0] 60 minutes from joining the queue, or 15 minutes before closing, then the
        // department, Admin and SuperAdmin are alerted until the file is uploaded.
        { k: 'dec', l: 'Uploaded by 60 min or closing?', mainLabel: 'yes',
          side: { l: 'Alert staff and Admin', label: 'no' } },
        { k: 'io', l: formStep },
        { k: 'dec', l: 'Ready to release?', mainLabel: 'yes',
          side: { l: 'Save for later', label: 'no', toEnd: true } },
        { k: 'proc', l: 'Authorise: copy in portal' },
        { k: 'dec', l: 'Email report to patient?', mainLabel: 'no',
          side: { l: 'Send report by email', label: 'yes' } },
        { k: 'proc', l: 'Ticket moves to history' }],
      // [1.156.0] A wrong patient or file is withdrawn; a wrong figure is amended, and the old
      // version stays readable until the new one is out.
      [{ k: 'proc', l: `${dept} History` },
        { k: 'proc', l: 'Search past reports' },
        { k: 'dec', l: 'Wrong patient or file?', mainLabel: 'no',
          side: { l: 'Withdraw with a reason', label: 'yes', toEnd: true } },
        { k: 'dec', l: 'Wrong figure on the report?', mainLabel: 'no',
          side: { l: 'Release corrected report', label: 'yes' } },
        { k: 'io', l: 'Print or email report' }],
      [{ k: 'proc', l: 'Patient Records' },
        { k: 'proc', l: 'Open patient and results' }],
    ],
  };
}

const CLIENT_FLOW = {
  name: 'Client Patient', actor: 'Client / Patient', landing: 'View services', gate: false,
  start: 'Open website', chain: true, colGap: 100,
  columns: [
    // Services are public, so a patient's login comes here rather than in the header. Entering the
    // emailed code finishes a sign-up already signed in, so a new account rejoins past the login.
    // With no payment account published, online booking is closed [1.153.0]. A Senior or PWD
    // declares it when booking, because a paid receipt is final [1.146.0].
    [{ k: 'proc', l: 'Book a visit' },
      { k: 'dec', l: 'Have an account?', mainLabel: 'yes', side: { l: 'Register, agree, verify code', label: 'no', mergeTo: 3 } },
      { k: 'proc', l: 'Login' },
      { k: 'dec', l: 'Access Granted?', mainLabel: 'yes', forgot: true },
      { k: 'proc', l: 'Choose patient profile' },
      { k: 'dec', l: 'Online booking open?', mainLabel: 'yes', side: { l: 'Told that booking is closed', label: 'no', toEnd: true } },
      { k: 'proc', l: 'Pick date, time and tests' },
      { k: 'dec', l: 'Senior or PWD?', mainLabel: 'no', side: { l: 'Declare discount with ID photo', label: 'yes' } },
      { k: 'dec', l: 'HMO patient?', mainLabel: 'no', side: { l: 'Attach HMO card and request', label: 'yes' } },
      { k: 'proc', l: 'Confirm booking' }],
    // Payment first [1.123.0] [1.132.0]: a self-pay booking holds its slot for the payment window,
    // an HMO booking until its start while the claim waits; neither paid nor approved in time,
    // the slot is released and the patient emailed. They may release it sooner themselves [1.146.0].
    [{ k: 'io', l: 'Get reference and email' },
      { k: 'dec', l: 'Keep the booking?', mainLabel: 'yes', side: { l: 'Release unpaid booking', label: 'no', toEnd: true } },
      { k: 'dec', l: 'Self-pay booking?', mainLabel: 'yes', side: { l: 'Wait for HMO decision', label: 'no', mergeTo: 2 } },
      { k: 'io', l: 'Confirm tests, pay, upload proof' },
      { k: 'dec', l: 'Paid or approved in time?', mainLabel: 'yes',
        side: { l: 'Slot released, emailed', label: 'no', toEnd: 'down' } },
      { k: 'io', l: 'Get QR booking pass' }],
    // A paid booking nobody came for stays, to be moved, and its patient is emailed the next morning.
    [{ k: 'io', l: 'Receive reminder email' },
      { k: 'dec', l: 'Need another date?', mainLabel: 'no', side: { l: 'Reschedule booking', label: 'yes' } },
      { k: 'dec', l: 'Arrived on the day?', mainLabel: 'yes', side: { l: 'Emailed, booking to be moved', label: 'no', toEnd: true } },
      { k: 'proc', l: 'Desk scans QR pass' },
      { k: 'io', l: 'Get queue ticket' }],
    [{ k: 'proc', l: 'Test performed' },
      { k: 'proc', l: 'Result released by clinic' },
      { k: 'io', l: 'Get results-ready email' },
      { k: 'io', l: 'View digital copy in portal' },
      { k: 'io', l: 'Answer visit feedback' }],
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
    // To each ellipse's left point. They all share that x, so no line reaches another ellipse; aimed
    // at the centre, the steep ones at each end ran through the names of the cases beside them.
    // They fan out from one point at the actor's middle, which also keeps them off the actor's name.
    p.edge({ id: p.cells[0].match(/id="(n\d+)"/)[1] }, cell, '', `${S.edgeStraight}exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;`);
  });
  // Each extension takes its base case's row, or the next free row below it: two extending one
  // case (Book Appointment, [1.146.0]) were drawn one on top of the other.
  const taken = new Set();
  (spec.relations || []).forEach((rel) => {
    const from = placed[rel.from];
    if (!from) return;
    let y = from.y;
    while (taken.has(y)) y += h + gap;
    taken.add(y);
    const cell = p.node(rel.to, 760, y, w, h, S.ellipse);
    p.edge(from, cell, rel.kind === 'include' ? '«include»' : '«extend»',
      `${S.edgeDashed}exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;`);
  });
  return p;
}

// Every account signs in the same way, so every sheet shows the same way back in.
const RESET = { from: 'Login', to: 'Reset Forgotten Password', kind: 'extend' };

const departmentCases = (name, actor, worklist, upload, print) => ({
  name, actor,
  cases: ['Login', 'View Today', 'Receive No-Upload Alert', worklist, upload, 'Release Result', 'Replace Released Report', 'Withdraw Released Report', 'Search Result History', 'View Patient Records', 'Logout'],
  relations: [RESET, { from: 'Release Result', to: 'Email Result to Patient', kind: 'extend' }, { from: 'Search Result History', to: print, kind: 'extend' }],
});

const USE_CASES = [
  { name: 'Super Admin', actor: 'Super Admin',
    cases: ['Login', 'View Today', 'Manage Roles and Permissions', 'Manage Per-Account Access', 'Manage Elevated Accounts', 'Manage Staff Accounts', 'Manage Services, Packages and Pricing', 'Publish Payment Channels', 'Set Cash Drawer Mode', 'Refund a Receipt', 'Manage Clinic Schedule', 'Generate Reports', 'View Patient Feedback', 'View Activity Log', 'Archive and Restore Patient Records', 'Logout'],
    relations: [RESET, { from: 'Manage Roles and Permissions', to: 'Record Change in Activity Log', kind: 'include' }, { from: 'Refund a Receipt', to: 'Email Patient and Mark Receipt', kind: 'include' }, { from: 'Generate Reports', to: 'Print or Export Report', kind: 'extend' }, { from: 'View Patient Feedback', to: 'Manage Feedback Questions', kind: 'extend' }] },
  { name: 'Admin', actor: 'Admin',
    cases: ['Login', 'View Today', 'Decide HMO Claims', 'Manage Staff Accounts', 'Manage Services, Packages and Pricing', 'Manage Clinic Schedule', 'View Appointments', 'Manage Patient Records', 'Archive and Restore Patient Records', 'Monitor Cashier Transactions', 'Receive No-Upload Alert', 'Generate Reports', 'View Patient Feedback', 'View Activity Log', 'Logout'],
    relations: [RESET, { from: 'Decide HMO Claims', to: 'Reprice Part-Covered Package', kind: 'include' }, { from: 'Monitor Cashier Transactions', to: 'View Daily Cash Counts', kind: 'extend' }, { from: 'Manage Patient Records', to: 'Print Records and Results', kind: 'extend' }, { from: 'Manage Patient Records', to: 'Invite or Unlink Portal Access', kind: 'extend' }, { from: 'Generate Reports', to: 'Print or Export Report', kind: 'extend' }, { from: 'View Patient Feedback', to: 'Manage Feedback Questions', kind: 'extend' }] },
  { name: 'Receptionist', actor: 'Receptionist',
    cases: ['Login', 'View Today', 'Find Patient or Booking', 'Verify QR Code', 'Check In Patient', 'Undo Check-In', 'Register Walk-In', 'Assign Tests to a Visit', 'Raise HMO Claim', 'Reschedule Booking', 'View Patient Records', 'View Visit History', 'Logout'],
    relations: [RESET, { from: 'Check In Patient', to: 'Issue Queue Ticket', kind: 'include' }, { from: 'Register Walk-In', to: 'Create Patient Record', kind: 'include' }, { from: 'View Patient Records', to: 'Invite Patient to the Portal', kind: 'extend' }, { from: 'View Visit History', to: 'Record Paper Feedback', kind: 'extend' }] },
  { name: 'Cashier', actor: 'Cashier',
    cases: ['Login', 'View Today', 'Confirm Final Tests', 'Process Billing and Payment', 'Apply Statutory Discount', 'Withdraw HMO Claim', 'Review Online Payment Proof', 'View Transaction History', 'Count the Drawer', 'View Patient Records', 'Logout'],
    // [1.146.0] A Senior Citizen / PWD discount declared online is granted once its ID is checked.
    relations: [RESET, { from: 'Process Billing and Payment', to: 'Issue Receipt', kind: 'include' }, { from: 'Count the Drawer', to: 'Print Cash Count Sheet', kind: 'extend' }, { from: 'View Transaction History', to: 'Print Receipt Copy', kind: 'extend' }, { from: 'Review Online Payment Proof', to: 'Check Declared Senior/PWD ID', kind: 'extend' }] },
  departmentCases('Laboratory Staff', 'Laboratory Staff', 'View Laboratory Worklist', 'Upload Laboratory Report', 'Print Laboratory Result'),
  departmentCases('Ultrasound Staff', 'Ultrasound Staff', 'View Ultrasound Worklist', 'Upload Ultrasound Report', 'Print Ultrasound Result'),
  // [1.143.0] X-ray uploads and releases its reports here again, as the other departments do.
  departmentCases('Xray Staff', 'X-Ray Staff', 'View X-Ray Worklist', 'Upload X-Ray Report', 'Print X-Ray Result'),
  { name: 'Client Patient', actor: 'Client / Patient',
    // [1.146.0] An unpaid booking can be released by the patient, and a Senior / PWD discount declared.
    // [1.136.0] A walk-in's record reaches an account by invitation. [1.126.0] Anyone can check a report's code.
    cases: ['Register Account', 'Login', 'View Available Services', 'Manage Patient Profiles', 'Accept Record Invitation', 'Book Appointment', "Upload Doctor's Request", 'Reschedule Booking', 'Release Unpaid Booking', 'Pay Online and Upload Proof', 'View Digital Copy of Results', 'View Receipt', 'Answer Visit Feedback', 'Manage Account Profile', 'Logout'],
    relations: [{ from: 'Register Account', to: 'Verify Emailed Code', kind: 'include' }, { from: 'Register Account', to: 'Agree to Terms and Privacy Policy', kind: 'include' }, RESET, { from: 'Login', to: 'Sign In with Google', kind: 'extend' }, { from: 'Book Appointment', to: 'Generate QR Booking Pass', kind: 'extend' }, { from: 'Book Appointment', to: 'Declare Senior/PWD Discount', kind: 'extend' }, { from: 'Pay Online and Upload Proof', to: 'Confirm Final Tests', kind: 'include' }, { from: 'View Digital Copy of Results', to: 'Verify Report Code', kind: 'extend' }, { from: 'Manage Account Profile', to: 'Change Sign-In Email', kind: 'extend' }] },
];

// ── 3. DFD level 0 ──────────────────────────────────────────────────────────────────────────────
const SYSTEM_NAME = 'Enlogada Ultrasound and Diagnostic\nClinic Management System';
const SYSTEM_ONE_LINE = 'Enlogada Ultrasound and Diagnostic Clinic Management System';

// The paper's own Level 0 shape: a modest process box, a SMALL actor, and the flows routed
// around them. Steven's note — the actor must not be drawn as a tall slab.
//
// What makes it readable is the routing, not the box sizes. Every flow gets a corridor of its own,
// and the corridors are NESTED: the one furthest from the boxes starts furthest right on the actor
// and lands furthest left on the system, so no two flows in a group ever cross. Inputs run above
// the boxes and outputs below, so the direction is clear before the arrowhead is read, and each
// label sits alone on its own corridor.
function dfd0(spec) {
  const p = new Page(spec.name);
  const G = 44, TOP = 70, LEAD = 34;
  const SYS_X = 160, SYS_W = 420, SYS_H = 170;
  const ACT_X = 1120, ACT_W = 210, ACT_H = 90;
  const ins = spec.inputs, outs = spec.outputs;

  const sysY = TOP + LEAD + Math.max(0, ins.length - 1) * G;
  const sys = p.node(SYSTEM_ONE_LINE, SYS_X, sysY, SYS_W, SYS_H, S.system);
  const ent = p.node(spec.name, ACT_X, sysY + (SYS_H - ACT_H) / 2, ACT_W, ACT_H, S.entity);

  // Spread the attachment points along an edge, leaving the corners alone.
  const spread = (i, n, from, to) => (n < 2 ? (from + to) / 2 : from + (i * (to - from)) / (n - 1));

  ins.forEach((label, i) => {
    const y = sysY - LEAD - i * G;
    const fromX = spread(i, ins.length, 0.25, 0.8);          // further right the higher it climbs
    const toX = spread(i, ins.length, 0.85, 0.15);           // and further left where it comes down
    p.edge(ent, sys, label, S.edgeFlow + `exitX=${fromX.toFixed(3)};exitY=0;exitDx=0;exitDy=0;entryX=${toX.toFixed(3)};entryY=0;entryDx=0;entryDy=0;`,
      [[ACT_X + fromX * ACT_W, y], [SYS_X + toX * SYS_W, y]]);
  });
  outs.forEach((label, j) => {
    const y = sysY + SYS_H + LEAD + j * G;
    const fromX = spread(j, outs.length, 0.85, 0.15);
    const toX = spread(j, outs.length, 0.25, 0.8);
    p.edge(sys, ent, label, S.edgeFlow + `exitX=${fromX.toFixed(3)};exitY=1;exitDx=0;exitDy=0;entryX=${toX.toFixed(3)};entryY=1;entryDx=0;entryDy=0;`,
      [[SYS_X + fromX * SYS_W, y], [ACT_X + toX * ACT_W, y]]);
  });
  return p;
}

const DFD0 = [
  { name: 'Super Admin',
    inputs: ['Login details', 'Reset request and code', 'Role access', 'Elevated account', 'Services and prices', 'Payment channel', 'Cash drawer mode', 'Clinic hours', 'Refund request', 'Feedback questions', 'Report request'],
    outputs: ['Account confirmed', 'Reset code', 'Updated access', 'Account saved', 'Updated services', 'Published channel', 'Published hours', 'Refund record', 'Reports', 'Patient feedback', 'Audit trail'] },
  { name: 'Admin',
    inputs: ['Login details', 'Reset request and code', 'HMO decision', 'Staff account', 'Services and prices', 'Clinic hours', 'Record update', 'Portal access change', 'Feedback questions', 'Report request'],
    outputs: ['Account confirmed', 'Reset code', 'HMO claims', 'Account saved', 'Updated services', 'Published hours', 'Patient records', 'Reports', 'Payments and cash counts', 'Patient feedback', 'No-upload alert', 'Audit trail'] },
  { name: 'Receptionist',
    inputs: ['Login details', 'Reset request and code', 'Walk-in details', 'Scanned QR code', 'Undo check-in', 'Test request', 'HMO claim', 'Reschedule request', 'Portal invitation', 'Paper feedback'],
    outputs: ['Account confirmed', 'Reset code', 'Booking details', 'Queue ticket', 'Billing request', 'HMO decision', 'Patient records'] },
  { name: 'Cashier',
    inputs: ['Login details', 'Reset request and code', 'Confirmed tests', 'Payment details', 'Discount claim', 'Claim withdrawal', 'Proof decision', 'Cash count'],
    outputs: ['Account confirmed', 'Reset code', 'Patients to bill', 'Receipt', 'Payment proofs', 'Takings', 'Count sheet'] },
  { name: 'Laboratory Staff',
    inputs: ['Login details', 'Reset request and code', 'Laboratory report file', 'Release authorisation', 'Withdrawal reason', 'Email request'],
    outputs: ['Account confirmed', 'Reset code', 'Laboratory requests', 'Patient details', 'Released result', 'No-upload alert'] },
  { name: 'Ultrasound Staff',
    inputs: ['Login details', 'Reset request and code', 'Ultrasound report file', 'Release authorisation', 'Withdrawal reason', 'Email request'],
    outputs: ['Account confirmed', 'Reset code', 'Ultrasound requests', 'Patient details', 'Released result', 'No-upload alert'] },
  { name: 'Xray Staff',
    inputs: ['Login details', 'Reset request and code', 'X-ray report file', 'Release authorisation', 'Withdrawal reason', 'Email request'],
    outputs: ['Account confirmed', 'Reset code', 'X-ray requests', 'Patient details', 'Released result', 'No-upload alert'] },
  { name: 'Client Patient',
    inputs: ['Registration details', 'Verification code', 'Login details', 'Reset request and code', 'Patient profile', 'Invitation answer', 'Booking and doctor request', 'Discount ID', 'Reschedule request', 'Release request', 'Proof of payment', 'Visit feedback'],
    outputs: ['Emailed code', 'Account confirmed', 'Portal invitation', 'Booking reference', 'QR booking pass', 'Reminder and status emails', 'Receipt', 'Digital copy of result'] },
];

function dfd0Context() {
  const p = new Page('Context');
  const SYS_X = 700, SYS_W = 360, ROW0 = 120, ROW_GAP = 220, ENT_H = 80, ENT_W = 200;
  const sys = p.node(SYSTEM_ONE_LINE, SYS_X, 380, SYS_W, 220, S.system);
  const left =['Client / Patient', 'Receptionist', 'Cashier', 'Laboratory Staff'];
  const right = ['Ultrasound Staff', 'X-Ray Staff', 'Admin', 'Super Admin'];
  const labels = {
    'Client / Patient': 'bookings, payments, results',
    Receptionist: 'check-in, walk-ins, invitations',
    Cashier: 'billing, receipts, cash count',
    'Laboratory Staff': 'laboratory reports',
    'Ultrasound Staff': 'ultrasound reports',
    'X-Ray Staff': 'x-ray reports',
    Admin: 'HMO decisions, records, reports',
    'Super Admin': 'access, services, refunds',
  };
  // Every actor has a line of its own into the system, at its own height. Left to draw.io, two actors
  // shared a vertical run into the box, which reads as the two being connected to each other. The
  // outer rows take the lane nearer the system, so no line crosses another.
  const entryY = (i) => 0.2 + i * 0.2;
  const laneOut = (i) => (i === 0 || i === 3 ? 60 : 100);
  const sysY = (i) => 380 + entryY(i) * 220;
  left.forEach((name, i) => {
    const y = ROW0 + i * ROW_GAP;
    const e = p.node(name, 80, y, ENT_W, ENT_H, S.entity);
    const lane = SYS_X - laneOut(i);
    p.edge(e, sys, labels[name], `${S.edgeFlow}startArrow=classic;startFill=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=${entryY(i).toFixed(1)};entryDx=0;entryDy=0;`,
      [[lane, y + ENT_H / 2], [lane, sysY(i)]], { at: -1, dx: 130, dy: 0 });
  });
  right.forEach((name, i) => {
    const y = ROW0 + i * ROW_GAP;
    const e = p.node(name, 1480, y, ENT_W, ENT_H, S.entity);
    const lane = SYS_X + SYS_W + laneOut(i);
    p.edge(e, sys, labels[name], `${S.edgeFlow}startArrow=classic;startFill=1;exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=${entryY(i).toFixed(1)};entryDx=0;entryDy=0;`,
      [[lane, y + ENT_H / 2], [lane, sysY(i)]], { at: -1, dx: -130, dy: 0 });
  });
  return p;
}

// ── 4. DFD level 1 ──────────────────────────────────────────────────────────────────────────────
const STORES = {
  D1: 'Users and Access', D2: 'Patients', D3: 'Appointments and Visits',
  D4: 'Payments', D5: 'Service Catalogue', D6: 'Diagnostic Results',
  D7: 'HMO Claims', D8: 'Clinic Schedule', D9: 'Logs and Notifications',
  D10: 'Patient Feedback', D11: 'Clinic Settings',
};

// The shape the paper's own Level 1 figures use, and Steven's reference: ONE small actor at the
// top left, the processes numbered down the middle, the data stores down the right.
//
// What has to be got right is the left margin, because that is where every flow to and from the
// actor runs. Each flow is given a TRACK of its own there — a vertical line at its own x — rather
// than a single shared trunk, which is what put ten labels on one line and left nothing to say
// which process each belonged to. The tracks are ordered so the lower the process, the further
// left its track, and a flow leaves the actor lower the further down it is going; with those two
// rules together no two flows ever cross. Each label sits on the horizontal run at the PROCESS
// end, where it is next to the thing it describes.
function dfd1(spec) {
  const p = new Page(spec.name);
  const PROC_H = 116, ROW_H = 190, TOP = 70;
  const total = spec.processes.length * ROW_H - (ROW_H - PROC_H);

  // Every flow on the sheet, in the order it leaves the actor: top to bottom, process by process.
  const all = spec.processes.flatMap((proc, i) => [
    ...(proc.in || []).map((label) => ({ i, label, into: true })),
    ...(proc.out || []).map((label) => ({ i, label, into: false })),
  ]);

  // The margin is as wide as the sheet's flows need, or the leftmost tracks run into the actor. The
  // actor grows only enough to keep its flows 8px apart where they leave it.
  const TRACK_GAP = 22;
  const ENT_X = 40, ENT_W = 200, ENT_H = Math.max(150, (all.length + 1) * 8);
  const PROC_W = 280;
  const PROC_X = Math.max(700, ENT_X + ENT_W + 40 + all.length * TRACK_GAP + 170);
  const STORE_X = PROC_X + 480;
  // The tracks stop 170px short of the process, which leaves a clear band for the labels.
  const TRACK_FIRST = PROC_X - 170, LABEL = { dx: -80, dy: 0 };

  const ent = p.node(spec.name, ENT_X, TOP, ENT_W, ENT_H, S.entity);
  const entY = (g) => TOP + ((g + 1) * ENT_H) / (all.length + 1);

  let g = 0;
  spec.processes.forEach((proc, i) => {
    const y = TOP + i * ROW_H;
    const lane = p.node(proc.n, PROC_X, y, PROC_W, PROC_H, S.procHead);
    p.node(proc.name, 0, 24, PROC_W, PROC_H - 24, S.procBody, lane.id);

    const ins = proc.in || [], outs = proc.out || [];
    const flows = ins.length + outs.length;
    const laneY = (j) => y + ((j + 1) * PROC_H) / (flows + 1);

    [...ins.map((l) => ({ l, into: true })), ...outs.map((l) => ({ l, into: false }))]
      .forEach(({ l, into }, j) => {
        const ay = entY(g), py = laneY(j), track = TRACK_FIRST - g * TRACK_GAP;
        g += 1;
        const at = `exitX=1;exitY=${(((ay - TOP) / ENT_H)).toFixed(4)};exitDx=0;exitDy=0;`;
        const on = `entryX=0;entryY=${(((py - y) / PROC_H)).toFixed(4)};entryDx=0;entryDy=0;`;
        if (into) {
          p.edge(ent, lane, l, S.edgeFlow + at + on, [[track, ay], [track, py]], { at: 1, ...LABEL });
        } else {
          p.edge(lane, ent, l, S.edgeFlow
            + `exitX=0;exitY=${(((py - y) / PROC_H)).toFixed(4)};exitDx=0;exitDy=0;`
            + `entryX=1;entryY=${(((ay - TOP) / ENT_H)).toFixed(4)};entryDx=0;entryDy=0;`,
            [[track, py], [track, ay]], { at: -1, ...LABEL });
        }
      });

    // Each store sits at its own height beside this process, with its read and its write on their
    // own lines. Two stores fit inside the row; a third would start crowding the row below.
    const stores = proc.stores || [];
    const ST_H = 62, ST_GAP = 12;
    stores.forEach((st, k) => {
      const sy = y - 4 + k * (ST_H + ST_GAP);
      const tag = p.node(st.id, STORE_X, sy, 44, ST_H, S.storeTag);
      p.node(STORES[st.id], STORE_X + 44, sy, 250, ST_H, S.storeName);
      const pair = (st.to ? 1 : 0) + (st.from ? 1 : 0);
      let n = 0;
      const nextY = () => { n += 1; return sy + (n * ST_H) / (pair + 1); };
      if (st.to) {
        const fy = nextY();
        p.edge(lane, tag, st.to, S.edgeFlow
          + `exitX=1;exitY=${(((fy - y) / PROC_H)).toFixed(4)};exitDx=0;exitDy=0;entryX=0;entryY=${(((fy - sy) / ST_H)).toFixed(4)};entryDx=0;entryDy=0;`);
      }
      if (st.from) {
        const fy = nextY();
        p.edge(tag, lane, st.from, S.edgeFlow
          + `exitX=0;exitY=${(((fy - sy) / ST_H)).toFixed(4)};exitDx=0;exitDy=0;entryX=1;entryY=${(((fy - y) / PROC_H)).toFixed(4)};entryDx=0;entryDy=0;`);
      }
    });
  });

  // Said once, at the foot, and only where a store really is drawn twice.
  const drawn = spec.processes.flatMap((proc) => (proc.stores || []).map((st) => st.id));
  if (drawn.length !== new Set(drawn).size) {
    p.node('A data store drawn more than once on this sheet is the same store.',
      ENT_X, TOP + total + 40, 520, 44, S.note);
  }
  return p;
}

const P = {
  login: { n: '1.0', name: 'Manage Login' },
  profiles: { n: '2.0', name: 'Manage Patient Profiles' },
  appts: { n: '3.0', name: 'Manage Appointments' },
  checkin: { n: '4.0', name: 'Check In and Issue Ticket' },
  requests: { n: '5.0', name: 'Manage Test Requests' },
  hmoRaise: { n: '6.0', name: 'Record HMO Claim' },
  hmoDecide: { n: '7.0', name: 'Decide HMO Claim' },
  billing: { n: '8.0', name: 'Process Payment' },
  proof: { n: '9.0', name: 'Review Payment Proof' },
  release: { n: '10.0', name: 'Release Visit' },
  results: { n: '11.0', name: 'Upload Results' },
  deliver: { n: '12.0', name: 'Release Results' },
  records: { n: '13.0', name: 'Manage Patient Records' },
  catalogue: { n: '14.0', name: 'Manage Services and Prices' },
  schedule: { n: '15.0', name: 'Manage Schedule' },
  staff: { n: '16.0', name: 'Manage Staff Accounts' },
  rbac: { n: '17.0', name: 'Manage Roles and Access' },
  reports: { n: '18.0', name: 'Generate Reports' },
  notify: { n: '19.0', name: 'Send Emails' },
  audit: { n: '20.0', name: 'Record Audit Trail' },
  feedback: { n: '21.0', name: 'Manage Patient Feedback' },
  refund: { n: '22.0', name: 'Process Refund' },
  cash: { n: '23.0', name: 'Count the Drawer' },
  portal: { n: '24.0', name: 'Manage Portal Access' },
  withdraw: { n: '25.0', name: 'Withdraw Report' },
  alert: { n: '26.0', name: 'Alert on Unuploaded Results' },
  settings: { n: '27.0', name: 'Set Cash Drawer Mode' },
  channels: { n: '28.0', name: 'Publish Payment Channels' },
  hmoWithdraw: { n: '29.0', name: 'Withdraw HMO Claim' },
};
const login = () => ({ ...P.login, in: ['Login details', 'Reset request and code'], out: ['Account confirmed', 'Reset code'], stores: [{ id: 'D1', to: 'Check credentials, save password', from: 'Account details' }] });

const DFD1 = [
  { name: 'Super Admin', processes: [
    login(), { ...P.rbac, in: ['Role access'], out: ['Updated access'], stores: [{ id: 'D1', to: 'Save access' }] },
    { ...P.staff, in: ['Elevated account'], out: ['Account saved'], stores: [{ id: 'D1', to: 'Save account' }] },
    { ...P.catalogue, in: ['Services and prices'], out: ['Updated services'], stores: [{ id: 'D5', to: 'Save service', from: 'Service list' }] },
    { ...P.channels, in: ['Payment channel'], out: ['Published channel'], stores: [{ id: 'D4', to: 'Save channel' }] },
    { ...P.settings, in: ['Cash drawer mode'], stores: [{ id: 'D11', to: 'Save mode' }] },
    { ...P.refund, in: ['Refund request'], out: ['Refund record'], stores: [{ id: 'D4', to: 'Save refund', from: 'Receipt' }, { id: 'D3', to: 'Close refunded tests' }] },
    { ...P.schedule, in: ['Clinic hours'], out: ['Published hours'], stores: [{ id: 'D8', to: 'Save hours' }, { id: 'D3', from: 'Affected bookings' }] },
    { ...P.reports, in: ['Report request'], out: ['Reports'], stores: [{ id: 'D4', from: 'Payments' }, { id: 'D3', from: 'Visits and tests' }] },
    { ...P.feedback, in: ['Feedback questions'], out: ['Patient feedback'], stores: [{ id: 'D10', to: 'Save questions', from: 'Feedback answers' }] },
    { ...P.audit, out: ['Audit trail'], stores: [{ id: 'D9', from: 'Audit entries' }] }] },
  { name: 'Admin', processes: [
    login(), { ...P.hmoDecide, in: ['HMO decision'], out: ['HMO claims'], stores: [{ id: 'D7', to: 'Save decision', from: 'Pending claims' }, { id: 'D3', to: 'Keep slot, reprice package' }] },
    { ...P.staff, in: ['Staff account'], out: ['Account saved'], stores: [{ id: 'D1', to: 'Save account' }] },
    { ...P.catalogue, in: ['Services and prices'], out: ['Updated services'], stores: [{ id: 'D5', to: 'Save service', from: 'Service list' }] },
    { ...P.schedule, in: ['Clinic hours'], out: ['Published hours'], stores: [{ id: 'D8', to: 'Save hours' }, { id: 'D3', from: 'Affected bookings' }] },
    { ...P.records, in: ['Record update'], out: ['Patient records'], stores: [{ id: 'D2', to: 'Update or archive', from: 'Patient details' }] },
    { ...P.portal, in: ['Portal access change'], stores: [{ id: 'D2', to: 'Save invitation or unlink' }, { id: 'D1', from: 'Account' }] },
    { ...P.reports, in: ['Report request'], out: ['Reports', 'Payments and cash counts'], stores: [{ id: 'D4', from: 'Payments, counts' }, { id: 'D3', from: 'Visits and tests' }] },
    { ...P.feedback, in: ['Feedback questions'], out: ['Patient feedback'], stores: [{ id: 'D10', to: 'Save questions', from: 'Feedback answers' }] },
    { ...P.alert, out: ['No-upload alert'], stores: [{ id: 'D3', from: 'Tests with no report' }, { id: 'D9', to: 'Save notification' }] },
    { ...P.audit, out: ['Audit trail'], stores: [{ id: 'D9', from: 'Audit entries' }] }] },
  { name: 'Receptionist', processes: [
    login(), { ...P.profiles, in: ['Walk-in details'], out: ['Patient records'], stores: [{ id: 'D2', to: 'Save patient', from: 'Patient details' }] },
    { ...P.portal, in: ['Portal invitation'], stores: [{ id: 'D2', to: 'Save invitation' }] },
    { ...P.appts, in: ['Reschedule request'], out: ['Booking details'], stores: [{ id: 'D3', to: 'Move booking', from: 'Bookings' }] },
    { ...P.checkin, in: ['Scanned QR code', 'Undo check-in'], out: ['Queue ticket'], stores: [{ id: 'D3', to: 'Save or undo arrival', from: "Today's bookings" }] },
    { ...P.requests, in: ['Test request'], out: ['Billing request'], stores: [{ id: 'D3', to: 'Save visit tests' }, { id: 'D5', from: 'Services and packages' }] },
    { ...P.hmoRaise, in: ['HMO claim'], out: ['HMO decision'], stores: [{ id: 'D7', to: 'Save claim and card', from: 'Decision' }] },
    { ...P.feedback, in: ['Paper feedback'], stores: [{ id: 'D10', to: 'Save paper feedback' }] }] },
  { name: 'Cashier', processes: [
    login(), { ...P.billing, in: ['Confirmed tests', 'Payment details', 'Discount claim'], out: ['Patients to bill', 'Receipt'], stores: [{ id: 'D4', to: 'Save payment', from: 'Discount types' }, { id: 'D3', from: 'Tests and prices' }] },
    { ...P.hmoWithdraw, in: ['Claim withdrawal'], stores: [{ id: 'D7', to: 'Close pending lines' }] },
    { ...P.proof, in: ['Proof decision'], out: ['Payment proofs'], stores: [{ id: 'D4', to: 'Save outcome', from: 'Uploaded proofs' }] },
    { ...P.release, stores: [{ id: 'D3', to: 'Set to processing' }] },
    { ...P.reports, out: ['Takings'], stores: [{ id: 'D4', from: 'Payments' }] },
    { ...P.cash, in: ['Cash count'], out: ['Count sheet'], stores: [{ id: 'D4', to: 'Save count', from: 'Expected cash' }] }] },
  ...['Laboratory', 'Ultrasound', 'Xray'].map((dept) => {
    const shown = dept === 'Xray' ? 'X-ray' : dept;
    return {
      name: `${dept} Staff`, processes: [
        login(),
        { ...P.results, in: [`${shown} report file`], out: [`${shown} requests`, 'Patient details'], stores: [{ id: 'D6', to: 'Save report and version' }, { id: 'D3', from: 'Released tests' }] },
        { ...P.deliver, in: ['Release authorisation'], out: ['Released result'], stores: [{ id: 'D6', to: 'Save release and code' }] },
        { ...P.withdraw, in: ['Withdrawal reason'], stores: [{ id: 'D6', to: 'Clear authorisation' }] },
        { ...P.notify, in: ['Email request'], stores: [{ id: 'D6', from: 'Report file' }] },
        { ...P.alert, out: ['No-upload alert'], stores: [{ id: 'D3', from: 'Tests with no report' }, { id: 'D9', to: 'Save notification' }] }],
    };
  }),
  { name: 'Client Patient', processes: [
    { ...P.login, in: ['Registration details', 'Verification code', 'Login details', 'Reset request and code'], out: ['Emailed code', 'Account confirmed'], stores: [{ id: 'D1', to: 'Save account and code', from: 'Account details' }] },
    { ...P.profiles, in: ['Patient profile', 'Invitation answer'], out: ['Portal invitation'], stores: [{ id: 'D2', to: 'Save profile, accept record', from: 'Profiles and invitations' }] },
    { ...P.appts, in: ['Booking and doctor request', 'Discount ID', 'Reschedule request', 'Release request'], out: ['Booking reference'], stores: [{ id: 'D3', to: 'Save, move or release', from: 'Open slots' }, { id: 'D8', from: 'Clinic hours' }] },
    { ...P.proof, in: ['Proof of payment'], out: ['Receipt', 'QR booking pass'], stores: [{ id: 'D4', to: 'Save submission' }, { id: 'D3', from: 'Paid or HMO booking' }] },
    { ...P.deliver, out: ['Digital copy of result'], stores: [{ id: 'D6', from: 'Released results' }] },
    // The server's own emails [1.130.0] [1.131.0] [1.148.0]: reminders read the bookings due one, and
    // an unpaid booking whose time is up is released and logged. Patient emails are not D9 rows; that
    // store's notifications are the staff bell.
    { ...P.notify, out: ['Reminder and status emails'], stores: [{ id: 'D3', to: 'Release unpaid booking', from: 'Bookings due' }, { id: 'D9', to: 'Release logged' }] },
    { ...P.feedback, in: ['Visit feedback'], stores: [{ id: 'D10', to: 'Save feedback', from: 'Survey questions' }] }] },
];

// ── 5. ERD, read from the live database ─────────────────────────────────────────────────────────
const SHEETS = [
  { name: 'Clinical Core', tables: ['patients', 'patient_types', 'patient_invitations', 'patient_visits', 'appointments', 'visit_tests', 'tests', 'test_categories', 'test_packages', 'test_package_items', 'test_results', 'feedback_questions', 'visit_feedback_answers'] },
  { name: 'Money and HMO', tables: ['payments', 'payment_refunds', 'payment_refund_tests', 'payment_methods', 'payment_submissions', 'cash_counts', 'discount_types', 'daily_counters', 'hmo_providers', 'hmo_requests', 'hmo_request_tests'] },
  { name: 'Access Schedule and System', tables: ['users', 'roles', 'permissions', 'role_permissions', 'user_roles', 'user_permissions', 'user_departments', 'auth_codes', 'clinic_settings', 'clinic_operating_hours', 'clinic_schedule_overrides', 'audit_log', 'notification_events', 'notification_reads'] },
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
  const ROW_H = 26, HEAD = 30;

  const rowIds = {};
  const columnOf = {};
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
    columnOf[tbl] = ci;
    rowIds[tbl] = {};
    cols.forEach((c, ri) => {
      const row = p.node('', 0, HEAD + ri * ROW_H, 360, ROW_H, S.tableRow, table.id);
      rowIds[tbl][c.column_name] = row;
      const isPk = (pks[tbl] || []).includes(c.column_name);
      const isFk = (fks[tbl] || []).some((f) => f.column === c.column_name);
      const key = isPk ? 'PK' : isFk ? 'FK' : '';
      p.node(key, 0, 0, 36, ROW_H, S.tableCell + 'align=center;fontStyle=1;', row.id);
      p.node(c.column_name, 36, 0, 196, ROW_H, S.tableCell + (isPk ? 'fontStyle=1;' : ''), row.id);
      p.node(pgType(c) + (c.is_nullable === 'NO' ? '' : ' ?'), 232, 0, 148, ROW_H, S.tableCell, row.id);
    });
  });

  // Foreign keys inside the sheet. A line runs in the gap beside a table's own column or the next
  // one; a parent further away would be reached straight through the tables between, so it is drawn
  // as a faint ghost at the foot of the child's column instead, as a parent on another sheet is. One
  // ghost per column that needs it.
  const ghosts = {};
  sheet.tables.forEach((tbl) => {
    (fks[tbl] || []).forEach((f) => {
      let target = placed[f.parent];
      const ci = columnOf[tbl];
      if (!target || Math.abs(columnOf[f.parent] - ci) > 1) {
        const key = `${f.parent}@${ci}`;
        if (!ghosts[key]) {
          ghosts[key] = p.node(`${f.parent}\n(${target ? 'on this sheet' : 'see the other sheet'})`, COL_X[ci], colBottom[ci], 360, 54, S.tableGhost);
          colBottom[ci] += 94;
        }
        target = ghosts[key];
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

  p.node(`${sheet.name}: ${sheet.tables.length} tables. PostgreSQL types. "?" = nullable. PK = primary key. FK = foreign key.`,
    60, Math.max(...colBottom) + 20, 640, 56, S.note);
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
    flowchart(departmentFlow('Laboratory', 'Upload report file')),
    flowchart(departmentFlow('Ultrasound', 'Upload report file')),
    flowchart(departmentFlow('X-Ray', 'Upload report file')),
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
