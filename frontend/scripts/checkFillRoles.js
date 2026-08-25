#!/usr/bin/env node
/**
 * Bans ramp shades that are ink-only from being used as a FILL.
 *
 * Why this exists. Dark mode works by remapping ramp tokens, and the remap is written for the INK
 * role: `--color-slate-900` goes from near-black to near-white so body text stays readable. Every
 * shade can also be used as a FILL, and there the same remap is an inversion — `bg-slate-900
 * text-white` renders white on #eef2f6, 1.12:1, which is what shipped on the queue ticket and the
 * walk-in Search button.
 *
 * That bug shape has now shipped three times (brand-600/700 fills, azure-600, then the neutral
 * ramp). Comments did not stop it — index.css already carried a warning saying this ramp "is NO
 * LONGER MONOTONIC" and four instances were written anyway. A grep does.
 *
 * The rule is deliberately ABSOLUTE rather than clever: these shades are ink, and every legitimate
 * solid fill in this app goes through a paired token instead — `emphasis`/`emphasis-foreground`,
 * `destructive`/`destructive-foreground`, `rail`, `scrim`. Pairing the fill with its foreground is
 * what makes the two halves impossible to flip independently, which was the actual root cause.
 * Checking the fill alone keeps this script context-free: no pairing analysis, no false positives,
 * and it fails on the thing you wrote rather than on the foreground you forgot.
 *
 * It also reads the dark block out of index.css at runtime and reports any shade NOT in the ban
 * list whose dark value is light while being used as a fill — so the check widens as that block
 * grows. prose_scan.py's documented weakness is that its HOOKS list is its eyesight; this avoids
 * inheriting that.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');
const CSS = path.join(SRC, 'index.css');

// Ink-only shades. A fill wanting this tone uses a paired token.
const BANNED = /(?:^|[":\s])((?:[a-z-]+:)*)bg-((?:slate|gray)-(?:700|800|900|950)|(?:rose|red)-(?:600|700|800))(?![\w-])/g;

const SUGGEST = {
  slate: 'bg-emphasis text-emphasis-foreground', gray: 'bg-emphasis text-emphasis-foreground',
  rose: 'bg-destructive text-destructive-foreground', red: 'bg-destructive text-destructive-foreground',
};

const lum = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

// Shades the dark block turns LIGHT. Used as a fill, these invert.
//
// Scoped to the ROOT `html[data-theme="dark"] {` token block only. Scoped blocks further down
// (e.g. `html[data-theme="dark"] .auth-panel`, which rebinds azure back to LIGHT values because
// that panel is dark in both themes) would otherwise be read as ramp definitions and flag azure
// as inverted — the opposite of true.
function darkTokenBlock() {
  const css = fs.readFileSync(CSS, 'utf8');
  const start = css.indexOf('html[data-theme="dark"] {');
  if (start < 0) return '';
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i);
  }
  return '';
}

function invertedShades() {
  const out = new Set();
  for (const m of darkTokenBlock().matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    const l = lum(m[2]);
    if (l !== null && l > 0.5) out.add(m[1]);
  }
  return out;
}

// A utility that index.css already pins back for the fill role is handled; do not re-report it.
// Collected by reading every dark-scoped rule that names a `bg-` utility rather than by matching
// a selector: the escaped forms are awkward to express as a regex and easy to get subtly wrong.
const overriddenFills = (() => {
  const out = new Set();
  for (const line of fs.readFileSync(CSS, 'utf8').split(/\r?\n/)) {
    if (!line.includes('data-theme="dark"')) continue;
    for (const m of line.matchAll(/bg-([a-z]+-\d{2,3})/g)) out.add(m[1]);
  }
  return out;
})();

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.jsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const errors = [];
const warnings = [];
const inverted = invertedShades();
const files = walk(SRC);

for (const file of files) {
  const rel = path.relative(path.join(__dirname, '..'), file);
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, n) => {
    for (const m of line.matchAll(BANNED)) {
      const ramp = m[2].split('-')[0];
      errors.push(`${rel}:${n + 1}  bg-${m[2]} is ink-only — use ${SUGGEST[ramp]}`);
    }
    // Widening pass: a fill on any other shade the dark block lightens.
    for (const m of line.matchAll(/(?:^|[":\s])(?:[a-z-]+:)*bg-([a-z]+-\d{2,3})(?![\w-])/g)) {
      if (inverted.has(m[1]) && !overriddenFills.has(m[1])
          && !/(?:slate|gray)-(?:700|800|900|950)|(?:rose|red)-(?:600|700|800)/.test(m[1])) {
        warnings.push(`${rel}:${n + 1}  bg-${m[1]} — dark value is light; confirm it is not a fill under light text`);
      }
    }
  });
}

for (const w of warnings) console.warn(`  warn  ${w}`);
if (errors.length) {
  console.error(`\nfill-role check FAILED — ${errors.length} ink-only shade(s) used as a fill:\n`);
  for (const e of errors) console.error(`  ${e}`);
  console.error('\nA fill and its foreground are two halves of one decision. Paired tokens keep them together.\n');
  process.exit(1);
}
console.log(`fill-role check: ${files.length} files, 0 violations${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
