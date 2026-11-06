/**
 * The paper's one-page ERD: every table, its key columns only, coloured by domain.
 *
 *   node docs/diagrams/buildErdOverview.cjs
 *
 * erd.drawio holds the full tables across three sheets. This is the figure that sits in the paper,
 * so it shows PK, FK and unique columns and counts the rest, the way the paper's first ERD did. It
 * reads the live database, so it cannot drift from the schema, and it fails if a table is missing
 * from the layout or a line runs through a table. Writes erd-overview.svg and png/erd-overview.png.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'backend');

const DOMAINS = {
  access: { n: 1, name: 'Accounts & Access', fill: '#c9d8ef' },
  patients: { n: 2, name: 'Patients & Visits', fill: '#bfe3d6' },
  results: { n: 3, name: 'Results', fill: '#d9cdeb' },
  money: { n: 4, name: 'Payments', fill: '#f2dfb0' },
  hmo: { n: 5, name: 'HMO Claims', fill: '#f4c9cf' },
  ops: { n: 6, name: 'Operations', fill: '#d5dfc9' },
};

// Top to bottom in each column. Tables that reference each other sit in the same or the next column.
const LAYOUT = [
  [['users', 'access'], ['auth_codes', 'access'], ['user_roles', 'access'], ['roles', 'access'], ['role_permissions', 'access'],
    ['permissions', 'access'], ['user_permissions', 'access'], ['user_departments', 'access'], ['audit_log', 'access'], ['clinic_settings', 'ops']],
  [['patient_types', 'patients'], ['patients', 'patients'], ['patient_invitations', 'patients'], ['discount_types', 'money'], ['patient_visits', 'patients'],
    ['appointments', 'patients'], ['feedback_questions', 'ops'], ['visit_feedback_answers', 'ops'], ['notification_events', 'ops'], ['notification_reads', 'ops']],
  [['test_categories', 'results'], ['tests', 'results'], ['test_packages', 'results'], ['test_package_items', 'results'], ['visit_tests', 'results'],
    ['test_results', 'results'], ['hmo_providers', 'hmo'], ['hmo_requests', 'hmo'], ['hmo_request_tests', 'hmo']],
  [['payment_methods', 'money'], ['payments', 'money'], ['payment_submissions', 'money'], ['payment_refunds', 'money'], ['payment_refund_tests', 'money'],
    ['cash_counts', 'money'], ['daily_counters', 'ops'], ['clinic_operating_hours', 'ops'], ['clinic_schedule_overrides', 'ops']],
];

const TW = 212, HEAD = 19, ROW = 14, MORE = 14, CORRIDOR = 86, MARGIN = 18;
const TARGET_H = 1500, LEGEND_H = 62;

async function readSchema() {
  require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
  const db = require(path.join(BACKEND, 'src', 'config', 'database'));
  const cols = await db.query(`SELECT table_name, column_name, is_nullable, data_type, character_maximum_length
      FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`);
  const keys = await db.query(`
    SELECT con.contype, src.relname AS child, tgt.relname AS parent, array_agg(a.attname::text ORDER BY k.ord) AS columns
      FROM pg_constraint con
      JOIN pg_class src ON src.oid = con.conrelid
      LEFT JOIN pg_class tgt ON tgt.oid = con.confrelid
      JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
      JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = k.attnum
      JOIN pg_namespace n ON n.oid = src.relnamespace
     WHERE n.nspname='public' AND con.contype IN ('p','f')
     GROUP BY con.contype, src.relname, tgt.relname, con.conname`);
  const uniq = await db.query(`
    SELECT t.relname AS tbl, array_agg(a.attname::text) AS columns
      FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(i.indkey)
     WHERE n.nspname='public' AND i.indisunique AND NOT i.indisprimary AND i.indpred IS NULL
     GROUP BY t.relname, i.indexrelid`);
  const schema = { columns: {}, pks: {}, fks: [], uniques: {} };
  cols.rows.forEach((c) => { (schema.columns[c.table_name] ||= []).push(c); });
  keys.rows.forEach((k) => {
    if (k.contype === 'p') schema.pks[k.child] = k.columns;
    else k.columns.forEach((column) => schema.fks.push({ child: k.child, column, parent: k.parent }));
  });
  uniq.rows.forEach((u) => { if (u.columns.length === 1) (schema.uniques[u.tbl] ||= []).push(u.columns[0]); });
  return schema;
}

const typeOf = (c) => {
  const t = c.data_type;
  if (t === 'character varying') return c.character_maximum_length ? `VARCHAR(${c.character_maximum_length})` : 'VARCHAR';
  if (t === 'timestamp without time zone' || t === 'timestamp with time zone') return 'TIMESTAMP';
  if (t === 'time without time zone') return 'TIME';
  return t.toUpperCase();
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function layout(schema) {
  const inLayout = LAYOUT.flat().map(([n]) => n);
  const missing = Object.keys(schema.columns).filter((t) => !inLayout.includes(t));
  const extra = inLayout.filter((t) => !schema.columns[t]);
  if (missing.length || extra.length) throw new Error(`Layout does not match the database. Missing: ${missing}. Unknown: ${extra}.`);

  const tables = {};
  LAYOUT.forEach((column, ci) => {
    const built = column.map(([name, domain]) => {
      const cols = schema.columns[name];
      const pk = schema.pks[name] || [];
      const fk = schema.fks.filter((f) => f.child === name).map((f) => f.column);
      const uq = schema.uniques[name] || [];
      const rows = cols.filter((c) => pk.includes(c.column_name) || fk.includes(c.column_name) || uq.includes(c.column_name))
        .map((c) => ({
          name: c.column_name,
          key: pk.includes(c.column_name) && fk.includes(c.column_name) ? 'PF' : pk.includes(c.column_name) ? 'PK' : fk.includes(c.column_name) ? 'FK' : 'UQ',
          req: c.is_nullable === 'NO',
          type: typeOf(c),
        }));
      const more = cols.length - rows.length;
      const h = HEAD + rows.length * ROW + (more > 0 ? MORE : 3);
      return { name, domain, rows, more, h, column: ci };
    });
    const used = built.reduce((s, t) => s + t.h, 0);
    const gap = (TARGET_H - used) / Math.max(1, built.length - 1);
    if (gap < 20) throw new Error(`Column ${ci} is too full: gap ${gap.toFixed(1)}`);
    let y = MARGIN;
    built.forEach((t) => {
      t.x = MARGIN + ci * (TW + CORRIDOR);
      t.y = Math.round(y);
      y += t.h + gap;
      tables[t.name] = t;
    });
  });
  return tables;
}

const rowY = (t, name) => {
  const i = t.rows.findIndex((r) => r.name === name);
  return t.y + HEAD + (Math.max(i, 0) + 0.5) * ROW;
};

function route(schema, tables) {
  const corridorX = (i) => MARGIN + TW + i * (TW + CORRIDOR);   // left edge of the corridor right of column i
  const tracks = {};
  const trackFor = (corridor, parent) => {
    const list = (tracks[corridor] ||= []);
    if (!list.includes(parent)) list.push(parent);
    const k = list.indexOf(parent);
    // users takes the middle of each corridor, and the rest spread out on either side of it.
    const step = 5.5, mid = CORRIDOR / 2;
    const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step;
    if (Math.abs(off) > mid - 15) throw new Error(`Corridor ${corridor} is out of tracks at ${parent}`);
    return corridorX(corridor) + mid + off;
  };
  // Order: users first, so it holds the middle track everywhere.
  const fks = schema.fks.slice().sort((a, b) => (a.parent === 'users' ? -1 : 0) - (b.parent === 'users' ? -1 : 0));

  const boxes = Object.values(tables);
  const freeY = (columns, near) => {
    // A y clear of every table in these columns, with room for several lines.
    const blocked = columns.flatMap((c) => boxes.filter((t) => t.column === c).map((t) => [t.y - 7, t.y + t.h + 7]));
    const candidates = [];
    for (let y = MARGIN; y < MARGIN + TARGET_H; y += 3) {
      if (!blocked.some(([a, b]) => y > a && y < b)) candidates.push(y);
    }
    if (!candidates.length) throw new Error(`No clear row across columns ${columns}`);
    return candidates.sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
  };
  const bands = {};
  const usedY = [];

  const edges = [];
  fks.forEach((f) => {
    const c = tables[f.child], p = tables[f.parent];
    const yc = rowY(c, f.column);
    const yp = rowY(p, (schema.pks[f.parent] || [])[0]);
    const unique = (schema.uniques[f.child] || []).includes(f.column);
    const staff = f.parent === 'users' && !['user_id'].includes(f.column);
    let pts;
    if (f.child === f.parent) {
      // A table pointing at itself: a small loop on its own right side.
      const x = c.x + TW;
      pts = [[x, yc], [x + 16, yc], [x + 16, yp], [x, yp]];
    } else if (c.column === p.column) {
      const cor = c.column === LAYOUT.length - 1 ? c.column - 1 : c.column;
      const side = c.column === LAYOUT.length - 1 ? c.x : c.x + TW;
      const tx = trackFor(cor, f.parent);
      pts = [[side, yc], [tx, yc], [tx, yp], [side, yp]];
    } else {
      const right = p.column > c.column;
      const near = right ? c.column : c.column - 1;
      const far = right ? p.column - 1 : p.column;
      const cx = right ? c.x + TW : c.x;
      const px = right ? p.x : p.x + TW;
      if (near === far) {
        const tx = trackFor(near, f.parent);
        pts = [[cx, yc], [tx, yc], [tx, yp], [px, yp]];
      } else {
        const between = [];
        for (let k = Math.min(c.column, p.column) + 1; k < Math.max(c.column, p.column); k += 1) between.push(k);
        const t1 = trackFor(near, f.parent), t2 = trackFor(far, f.parent);
        const key = `${f.parent}|${near}|${far}`;
        if (bands[key] === undefined) {
          const y = freeY(between, f.parent === 'users' ? yp : (yc + yp) / 2).find((v) => !usedY.some((u) => Math.abs(u - v) < 5));
          if (y === undefined) throw new Error(`No free row for ${key}`);
          usedY.push(y);
          bands[key] = y;
        }
        const by = bands[key];
        pts = [[cx, yc], [t1, yc], [t1, by], [t2, by], [t2, yp], [px, yp]];
      }
    }
    edges.push({ ...f, pts, unique, staff, childSide: pts[1][0] > pts[0][0] ? 1 : -1, parentSide: pts[pts.length - 2][0] > pts[pts.length - 1][0] ? 1 : -1 });
  });
  return edges;
}

function checkLines(edges, tables) {
  const problems = [];
  edges.forEach((e) => {
    for (let i = 0; i + 1 < e.pts.length; i += 1) {
      const [x1, y1] = e.pts[i], [x2, y2] = e.pts[i + 1];
      Object.values(tables).forEach((t) => {
        const ax = t.x + 1, bx = t.x + TW - 1, ay = t.y + 1, by = t.y + t.h - 1;
        if (Math.max(x1, x2) > ax && Math.min(x1, x2) < bx && Math.max(y1, y2) > ay && Math.min(y1, y2) < by) {
          problems.push(`${e.child}.${e.column} -> ${e.parent} passes through ${t.name}`);
        }
      });
    }
  });
  return problems;
}

function svg(tables, edges) {
  const W = MARGIN * 2 + LAYOUT.length * TW + (LAYOUT.length - 1) * CORRIDOR;
  const H = MARGIN + TARGET_H + 16 + LEGEND_H;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`];
  const INK = '#2b3440', PALE = '#aeb7c2';
  const line = (x1, y1, x2, y2, c, w = 1) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"/>`;
  const crow = (x, y, s, c) => line(x, y - 4.5, x + s * 9, y, c) + line(x, y + 4.5, x + s * 9, y, c) + line(x + s * 11, y - 4, x + s * 11, y + 4, c);
  const one = (x, y, s, c) => line(x + s * 5, y - 4, x + s * 5, y + 4, c) + line(x + s * 9, y - 4, x + s * 9, y + 4, c);

  // Pale lines underneath, so a table's own relationships read on top.
  edges.slice().sort((a, b) => Number(b.staff) - Number(a.staff)).forEach((e) => {
    const c = e.staff ? PALE : INK;
    out.push(`<polyline fill="none" stroke="${c}" stroke-width="${e.staff ? 0.9 : 1.05}" points="${e.pts.map((p) => p.join(',')).join(' ')}"/>`);
    const [x0, y0] = e.pts[0];
    const [xn, yn] = e.pts[e.pts.length - 1];
    out.push(e.unique ? one(x0, y0, e.childSide, c) : crow(x0, y0, e.childSide, c));
    out.push(one(xn, yn, e.parentSide, c));
  });

  Object.values(tables).forEach((t) => {
    const d = DOMAINS[t.domain];
    out.push(`<rect x="${t.x}" y="${t.y}" width="${TW}" height="${t.h}" rx="3" fill="#ffffff" stroke="#8d97a5" stroke-width="0.9"/>`);
    out.push(`<path d="M${t.x + 3} ${t.y}h${TW - 6}a3 3 0 0 1 3 3v${HEAD - 3}h${-TW}v${-(HEAD - 3)}a3 3 0 0 1 3 -3z" fill="${d.fill}" stroke="#8d97a5" stroke-width="0.9"/>`);
    out.push(`<text x="${t.x + TW / 2}" y="${t.y + 13.5}" font-size="11" font-weight="700" text-anchor="middle" fill="#111827">${esc(t.name)}</text>`);
    t.rows.forEach((r, i) => {
      const y = t.y + HEAD + i * ROW + 10.5;
      out.push(`<text x="${t.x + 6}" y="${y}" font-size="8.5" font-weight="700" fill="#475569">${r.key === 'PF' ? 'PK,FK' : r.key}</text>`);
      out.push(`<text x="${t.x + 34}" y="${y}" font-size="9.5" font-weight="${r.key.startsWith('P') ? 700 : 400}" fill="#111827">${esc(r.name)}${r.req && r.key !== 'PK' && r.key !== 'PF' ? ' *' : ''}</text>`);
      out.push(`<text x="${t.x + TW - 6}" y="${y}" font-size="8" text-anchor="end" fill="#64748b">${esc(r.type)}</text>`);
    });
    if (t.more > 0) {
      out.push(`<text x="${t.x + 34}" y="${t.y + HEAD + t.rows.length * ROW + 10}" font-size="8.5" font-style="italic" fill="#64748b">+ ${t.more} more column${t.more === 1 ? '' : 's'}</text>`);
    }
  });

  // The legend, along the foot.
  const ly = MARGIN + TARGET_H + 20;
  out.push(line(MARGIN, ly - 6, W - MARGIN, ly - 6, '#cbd5e1', 0.8));
  let x = MARGIN;
  const label = (s, dx) => { out.push(`<text x="${x}" y="${ly + 10}" font-size="9.5" fill="#334155">${esc(s)}</text>`); x += dx; };
  out.push(line(x, ly + 7, x + 28, ly + 7, INK) + one(x, ly + 7, 1, INK)); x += 34; label('one (the row referenced)', 138);
  out.push(line(x, ly + 7, x + 28, ly + 7, INK) + crow(x + 28, ly + 7, -1, INK)); x += 34; label('many', 42);
  out.push(line(x, ly + 7, x + 28, ly + 7, INK) + one(x + 28, ly + 7, -1, INK)); x += 34; label('at most one (one-to-one)', 136);
  out.push(line(x, ly + 7, x + 28, ly + 7, PALE)); x += 34; label('staff line: the user who recorded or approved', 240);
  label('PK primary key    FK foreign key    UQ unique    * required (NOT NULL)', 0);
  x = MARGIN;
  Object.values(DOMAINS).forEach((d) => {
    out.push(`<rect x="${x}" y="${ly + 24}" width="16" height="11" rx="2" fill="${d.fill}" stroke="#8d97a5" stroke-width="0.7"/>`);
    x += 21;
    const s = `${d.n} ${d.name}`;
    out.push(`<text x="${x}" y="${ly + 33}" font-size="9.5" fill="#334155">${esc(s)}</text>`);
    x += s.length * 5.4 + 16;
  });
  out.push(`<text x="${W - MARGIN}" y="${ly + 33}" font-size="9.5" text-anchor="end" fill="#334155">Key columns only; "+ n more" counts the rest.</text>`);
  out.push('</svg>');
  return { text: out.join('\n'), W, H };
}

(async () => {
  const schema = await readSchema();
  const tables = layout(schema);
  const edges = route(schema, tables);
  const problems = checkLines(edges, tables);
  problems.forEach((p) => console.log(`CROSSING ${p}`));
  const { text, W, H } = svg(tables, edges);
  fs.writeFileSync(path.join(__dirname, 'erd-overview.svg'), text);
  console.log(`${Object.keys(tables).length} tables, ${edges.length} foreign keys, ${problems.length} lines through a table, ${W}x${H}`);
  const { chromium } = require(path.join(ROOT, 'frontend', 'node_modules', 'playwright'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 3 });
  await page.setContent(`<!doctype html><html><body style="margin:0">${text}</body></html>`);
  await page.screenshot({ path: path.join(__dirname, 'png', 'erd-overview.png') });
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
