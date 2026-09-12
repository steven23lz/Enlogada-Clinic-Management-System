#!/usr/bin/env node
/**
 * Fails the build when an ink token cannot be read on a surface it actually lands on.
 *
 * ── Why a script and not a review note ──────────────────────────────────────────────────────
 *
 * `checkFillRoles.js` exists because comments did not stop the ink-as-fill bug shipping three
 * times — index.css carried a warning and four instances were written anyway. This is the same
 * argument applied to contrast, and it was written because deepening the canvas produced exactly
 * the failure it now catches:
 *
 *     ink-muted #64748b on white   4.76:1   passes
 *     ink-muted #64748b on canvas  4.12:1   FAILS
 *
 * The same token, legible inside a panel and not legible on the page behind it. No reviewer sees
 * that by looking, and no screenshot shows it, because both readings look grey and fine. It is
 * only visible as arithmetic.
 *
 * ── What it checks ──────────────────────────────────────────────────────────────────────────
 *
 * Every ink token against every surface it can appear on, in BOTH themes. Dark mode is not
 * assumed to inherit anything: the dark block redefines these tokens independently — deliberately,
 * because a dark theme needs a larger canvas/surface step than a light one — so it is measured
 * independently.
 *
 * WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large text and UI components. Tokens documented as
 * decorative are held to 3:1 and are listed explicitly, so "this one is only decoration" has to be
 * an argued exception rather than a silent default.
 *
 * Run: node scripts/checkContrast.js   (wired into `npm run lint`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS = path.join(__dirname, '..', 'src', 'index.css');

const AA_BODY = 4.5;
const AA_LARGE = 3.0;

/**
 * Ink tokens, and the surfaces each one legitimately sits on.
 *
 * A token is listed here because something renders text in it. Adding a token to index.css does
 * not automatically bring it under this check — that is deliberate: the list is a claim about
 * where a colour is USED, which only a person knows.
 */
// brand-100 and azure-100 are the peaks of the public site's page wash (`.wash-aurora`) [1.72.0].
// Text scrolls across them, so they are surfaces as much as the canvas beneath them is.
const WASH = ['brand-100', 'azure-100'];

const INK_ON_SURFACES = [
  { ink: 'ink', surfaces: ['surface', 'canvas', 'sunken', ...WASH], min: AA_BODY },
  { ink: 'ink-soft', surfaces: ['surface', 'canvas', 'sunken', ...WASH], min: AA_BODY },
  { ink: 'ink-muted', surfaces: ['surface', 'canvas', 'sunken', ...WASH], min: AA_BODY },
  // Decorative only — placeholder glyphs, separators, disabled affordances. Held to the UI
  // threshold rather than the body threshold, and that exemption is the reason it exists: without
  // it, `slate-400` gets used for real content because there is nowhere else to reach for.
  { ink: 'ink-faint', surfaces: ['surface', 'canvas'], min: AA_LARGE, decorative: true },
  { ink: 'foreground', surfaces: ['background', 'card', 'popover'], min: AA_BODY },
  { ink: 'muted-foreground', surfaces: ['surface', 'canvas', 'muted'], min: AA_BODY },
];

/** Paired fill/foreground tokens. Both halves must be defined in both themes, and must contrast. */
const PAIRS = [
  // The most-clicked element in the application, and the one this list did not cover. [1.65.0]
  //
  // `--color-primary` filled every Book Now, Sign In and Save at #53843b — 4.44:1 under white,
  // below the 4.50 floor. It got here because the list was written from the tokens that LOOKED
  // like fills (emphasis, destructive, rail) and `primary` reads as a brand colour rather than as
  // a surface something sits on. It is both.
  //
  // Its hover state was already compliant, so the control passed a glance and failed at rest.
  { fg: 'primary-foreground', bg: 'primary', min: AA_BODY },
  { fg: 'emphasis-foreground', bg: 'emphasis', min: AA_BODY },
  { fg: 'destructive-foreground', bg: 'destructive', min: AA_BODY },
  { fg: 'rail-ink', bg: 'rail', min: AA_BODY },
  { fg: 'rail-ink-soft', bg: 'rail', min: AA_BODY },
  { fg: 'rail-ink-muted', bg: 'rail', min: AA_LARGE, decorative: true },
  // The far end of the public site's brand gradient (`bg-gradient-brand`). [1.72.0] The near end is
  // `primary`, above. A gradient is only as legible as its worst stop.
  { fg: 'primary-foreground', bg: 'azure-500', min: AA_BODY },
];

/**
 * Dark hero meshes. [1.72.0] Text on one of these sits on the base colour AND on every glow at its
 * brightest, so it is measured against all of them. The colours are read out of the CSS rule
 * itself — the gradient the browser paints is the gradient that gets measured, and there is no
 * second copy of it here to drift out of step.
 *
 * `glass` is a translucent surface floating over the same mesh (the header pill). What its ink
 * actually sits on is the glass composited over each mesh colour, so that is what is measured. At
 * 0.74 opacity the pill looked better and its nav text failed at 4.24:1.
 */
const MESHES = [
  {
    selector: '.aurora',
    inks: [
      { ink: 'aurora-ink', min: AA_BODY },
      { ink: 'aurora-soft', min: AA_BODY },
      // Gradient text, used only at display size.
      { ink: 'aurora-accent', min: AA_LARGE },
      { ink: 'aurora-accent-2', min: AA_LARGE },
    ],
    glass: {
      selector: '.glass-pill',
      inks: [{ ink: 'ink', min: AA_BODY }, { ink: 'ink-soft', min: AA_BODY }],
    },
  },
];

// ── Colour maths ────────────────────────────────────────────────────────────────────────────

const srgbToLinear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** @returns {[number,number,number]|null} 0-1 sRGB, or null if the format is not understood. */
function parseColor(value) {
  if (!value) return null;
  const v = value.trim();

  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  }

  const short = /^#([0-9a-f]{3})$/i.exec(v);
  if (short) {
    return short[1].split('').map((c) => parseInt(c + c, 16) / 255);
  }

  const oklch = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/i.exec(v);
  if (oklch) return oklchToSrgb(Number(oklch[1]) / 100, Number(oklch[2]), Number(oklch[3]));

  return null;
}

/** OKLCH → linear sRGB → gamma sRGB. The app's rail/emphasis tokens are authored in oklch. */
function oklchToSrgb(Lp, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l = (Lp + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (Lp - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (Lp - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const gamma = (c) => {
    const x = Math.max(0, Math.min(1, c));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  return [gamma(lr), gamma(lg), gamma(lb)];
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ── Token extraction ────────────────────────────────────────────────────────────────────────

/**
 * Reads `--color-*` declarations out of a slice of CSS.
 * Later declarations win, matching the cascade within a single block.
 */
function readTokens(css) {
  const tokens = {};
  const re = /--color-([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(css)) !== null) tokens[m[1]] = m[2].trim();
  return tokens;
}

/** Comments stripped first: a declaration quoted inside a comment is not a declaration. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The bodies of every rule whose selector is exactly `selector` (`@theme`, the dark root). */
function bodiesOf(css, selector) {
  const out = [];
  for (let at = css.indexOf(`${selector} {`); at !== -1; at = css.indexOf(`${selector} {`, at + 1)) {
    const open = css.indexOf('{', at);
    out.push(css.slice(open + 1, css.indexOf('}', open)));
  }
  return out;
}

/**
 * The dark theme is the LIGHT tokens with the dark block's overrides applied on top — which is
 * how the cascade actually resolves it. Measuring the dark block alone would miss every token it
 * does not redefine, and those are exactly the ones most likely to be wrong in dark mode.
 *
 * Each theme reads ONLY the rules that define it. [1.72.0] This used to read every `--color-*`
 * declaration in the file, last one winning — so the "light" theme silently held the DARK block's
 * values for every token that block remaps (light ink-soft measured as #a3b0c2), and the dark
 * theme picked up tokens rebound inside a scoped rule (`.auth-panel`'s azure). Light mode was
 * therefore never actually measured for the remapped inks. Found when the Aurora checks reported
 * light-mode failures in colours the light theme does not use.
 */
function buildThemes(rawCss) {
  const css = stripComments(rawCss);
  const light = Object.assign({}, ...bodiesOf(css, '@theme').map(readTokens));
  const darkBodies = bodiesOf(css, 'html[data-theme="dark"]');
  const dark = darkBodies.length ? Object.assign({ ...light }, ...darkBodies.map(readTokens)) : light;
  return { light, dark };
}

// ── Reporting ───────────────────────────────────────────────────────────────────────────────

const failures = [];
const skipped = [];
let checked = 0;

function assertContrast(theme, tokens, fgName, bgName, min, decorative) {
  const fg = parseColor(tokens[fgName]);
  const bg = parseColor(tokens[bgName]);

  if (!fg || !bg) {
    // A token that is absent or in a format this cannot read is reported rather than passed over.
    // Silently skipping is how a check stops checking without anyone noticing.
    skipped.push(`${theme}: ${fgName} on ${bgName} — ${!tokens[fgName] ? `--color-${fgName} not defined` : !tokens[bgName] ? `--color-${bgName} not defined` : 'unreadable colour format'}`);
    return;
  }

  checked += 1;
  const ratio = contrast(fg, bg);
  if (ratio < min) {
    failures.push({ theme, fgName, bgName, ratio, min, decorative, fgValue: tokens[fgName], bgValue: tokens[bgName] });
  }
}

// ── Meshes ──────────────────────────────────────────────────────────────────────────────────

/** The body of the first rule whose selector is exactly `selector`, or null. */
function ruleBody(css, selector) {
  const at = css.indexOf(`${selector} {`);
  return at === -1 ? null : css.slice(at, css.indexOf('}', at));
}

const RGBA = /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)/;
const toStop = (m) => ({ rgb: [m[1], m[2], m[3]].map((c) => Number(c) / 255), alpha: Number(m[4]) });

/** The `rgb(r g b / a)` stops with a non-zero alpha — each glow, at its brightest. */
const glowsIn = (body) => [...body.matchAll(new RegExp(RGBA.source, 'g'))].map(toStop).filter((g) => g.alpha > 0);

/** `top` at `alpha`, composited over an opaque `bottom`. All channels 0-1. */
const over = (top, alpha, bottom) => top.map((c, i) => alpha * c + (1 - alpha) * bottom[i]);
const toHex = (rgb) => '#' + rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');

/**
 * Every colour text can land on in a mesh, for one theme: its base, and each glow composited over
 * it. A dark-theme rule, where one exists, supplies the dark glows; the base is resolved through
 * the theme's tokens, so a dark base arrives through the dark block without a rule of its own.
 */
function meshSurfaces(css, selector, theme, tokens) {
  const light = ruleBody(css, selector);
  if (!light) return null;
  const dark = theme === 'dark' ? ruleBody(css, `html[data-theme="dark"] ${selector}`) : null;
  const BASE = /background-color:\s*(?:var\(--color-([a-z0-9-]+)\)|(#[0-9a-f]{6}))/i;
  const decl = (dark && BASE.exec(dark)) || BASE.exec(light);
  const base = decl && parseColor(decl[1] ? tokens[decl[1]] : decl[2]);
  if (!base) return null;
  const lights = dark && glowsIn(dark).length ? glowsIn(dark) : glowsIn(light);
  return [base, ...lights.map((g) => over(g.rgb, g.alpha, base))];
}

/** The translucent pane a glass surface paints: its `background: rgb(r g b / a)`. */
function glassPane(css, selector, theme) {
  const body = (theme === 'dark' && ruleBody(css, `html[data-theme="dark"] ${selector}`)) || ruleBody(css, selector);
  const m = body && new RegExp(`background:\\s*${RGBA.source}`).exec(body);
  return m ? { rgb: [m[1], m[2], m[3]].map((c) => Number(c) / 255), alpha: Number(m[4]) } : null;
}

function assertOnSurfaces(theme, tokens, inkName, label, surfaces, min, decorative) {
  const fg = parseColor(tokens[inkName]);
  if (!fg) {
    skipped.push(`${theme}: ${inkName} on ${label} — --color-${inkName} not defined`);
    return;
  }
  for (const bg of surfaces) {
    checked += 1;
    const ratio = contrast(fg, bg);
    if (ratio < min) {
      failures.push({ theme, fgName: inkName, bgLabel: label, ratio, min, decorative, fgValue: tokens[inkName], bgValue: toHex(bg) });
    }
  }
}

function checkMeshes(css, themeName, tokens) {
  for (const mesh of MESHES) {
    const surfaces = meshSurfaces(css, mesh.selector, themeName, tokens);
    if (!surfaces) {
      skipped.push(`${themeName}: ${mesh.selector} — rule or base colour not found in index.css`);
      continue;
    }
    const label = `${mesh.selector} (base + ${surfaces.length - 1} glows)`;
    for (const { ink, min, decorative } of mesh.inks) {
      assertOnSurfaces(themeName, tokens, ink, label, surfaces, min, decorative);
    }
    if (!mesh.glass) continue;
    const pane = glassPane(css, mesh.glass.selector, themeName);
    if (!pane) {
      skipped.push(`${themeName}: ${mesh.glass.selector} — no translucent background found`);
      continue;
    }
    const composited = surfaces.map((s) => over(pane.rgb, pane.alpha, s));
    for (const { ink, min, decorative } of mesh.glass.inks) {
      assertOnSurfaces(themeName, tokens, ink, `${mesh.glass.selector} over ${mesh.selector}`, composited, min, decorative);
    }
  }
}

function main() {
  const css = fs.readFileSync(CSS, 'utf8');
  const themes = buildThemes(css);

  for (const [themeName, tokens] of Object.entries(themes)) {
    for (const { ink, surfaces, min, decorative } of INK_ON_SURFACES) {
      for (const surface of surfaces) assertContrast(themeName, tokens, ink, surface, min, decorative);
    }
    for (const { fg, bg, min, decorative } of PAIRS) {
      assertContrast(themeName, tokens, fg, bg, min, decorative);
    }
    checkMeshes(css, themeName, tokens);
  }

  if (skipped.length) {
    console.log(`contrast check: ${skipped.length} pair(s) not evaluated`);
    for (const s of skipped) console.log(`   · ${s}`);
  }

  if (failures.length) {
    // `checked` already counts the failures — every assertion increments it before it can fail.
    console.error(`\ncontrast check: ${failures.length} FAILING pair(s) of ${checked} checked\n`);
    for (const f of failures) {
      console.error(
        `  [${f.theme}] --color-${f.fgName} (${f.fgValue}) on ${f.bgLabel || `--color-${f.bgName}`} (${f.bgValue})\n` +
        `        ${f.ratio.toFixed(2)}:1  — needs ${f.min}:1${f.decorative ? ' (decorative threshold)' : ''}`
      );
    }
    console.error(
      '\n  Text at these ratios is unreadable for a large number of people, and the failure is\n' +
      '  invisible in a screenshot. Darken the ink, lighten the surface, or — if the token really\n' +
      '  is decoration — move it to the decorative list in scripts/checkContrast.js with a reason.\n'
    );
    process.exit(1);
  }

  console.log(`contrast check: ${checked} token pairs, both themes, 0 violations`);
}

main();
