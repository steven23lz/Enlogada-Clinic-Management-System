/**
 * One colour per diagnostic category, for the whole app. [1.28.0]
 *
 * These five categories were coloured twice, independently, and the two disagreed on every one
 * of them. The Service Volume chart had Laboratory green, Ultrasound blue, Xray amber, 2D Echo
 * violet, ECG cyan; the public Services page had Laboratory teal, Ultrasound sage, Xray indigo,
 * 2D Echo rose, ECG amber. A patient who browsed the services page and a manager who read the
 * report were looking at the same five things in two unrelated colour schemes, and Xray was
 * amber in one place and indigo in the other.
 *
 * Colour follows the entity, never the context it appears in. That is what makes it worth
 * anything: if Laboratory is always this green, the reader learns it once.
 *
 * The hex values are the chart's, because that palette was the one chosen against the
 * constraints that matter for colour — a lightness band, a chroma floor, colourblind separation
 * between adjacent pairs, and contrast against the surface. It passes all of them. The tint
 * classes here are the pale companions for an icon tile, where the hex is the saturated mark.
 *
 * Matching is by substring rather than exact name because the categories arrive from the
 * database and have been written as both "Xray" and "X-Ray" in different places.
 */

// Saturated marks — bars, dots, anything the eye reads as the datum itself.
export const CATEGORY_COLORS = {
  Laboratory: '#769046',   // brand green, the clinic's primary service
  Ultrasound: '#2563eb',   // chart-only blue; navy fails the categorical lightness check
  Xray: '#d97706',         // amber
  '2D Echo': '#7c3aed',    // violet
  ECG: '#0891b2',          // cyan
};

// Anything not in the map above: a category added to the database after this was written should
// look deliberately unremarkable rather than borrow another category's colour.
export const UNMAPPED_CATEGORY_COLOR = '#94a3b8';

// Pale tile + saturated glyph, for an icon beside a heading. Kept as Tailwind classes rather
// than derived from the hex, because an opacity variant of the mark colour is exactly the
// "five different pale greens on one screen" problem the design notes warn about.
const CATEGORY_TINTS = {
  Laboratory: 'bg-brand-50 text-brand-700',
  Ultrasound: 'bg-blue-50 text-blue-700',
  Xray: 'bg-amber-50 text-amber-700',
  '2D Echo': 'bg-violet-50 text-violet-700',
  ECG: 'bg-cyan-50 text-cyan-700',
};

const UNMAPPED_TINT = 'bg-slate-100 text-slate-700';

/** The canonical key for a category name as the database happens to have spelled it. */
export function categoryKey(name = '') {
  const lower = String(name).toLowerCase();
  if (lower.includes('lab')) return 'Laboratory';
  if (lower.includes('ultra')) return 'Ultrasound';
  if (lower.includes('xray') || lower.includes('x-ray')) return 'Xray';
  if (lower.includes('echo')) return '2D Echo';
  if (lower.includes('ecg')) return 'ECG';
  return null;
}

/** The saturated mark colour for a category, for charts and any coloured datum. */
export function categoryColor(name) {
  return CATEGORY_COLORS[categoryKey(name)] || UNMAPPED_CATEGORY_COLOR;
}

/** The pale tile classes for a category icon. */
export function categoryTint(name) {
  return CATEGORY_TINTS[categoryKey(name)] || UNMAPPED_TINT;
}
