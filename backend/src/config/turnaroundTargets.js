/**
 * Turnaround targets, in minutes from payment to released report. [1.62.0]
 *
 * ── These are DEFAULTS, and the clinic has not agreed them ──────────────────────────────────
 *
 * Stated plainly because a target rendered as a line on a chart looks like a commitment somebody
 * made, and nobody here has. They are starting values chosen to be plausible for a walk-in
 * diagnostic clinic — X-Ray fastest because the image is read on the spot, Laboratory slowest
 * because an analyser run has its own clock — and they are here so the chart has a reference line
 * at all, not because they are the right numbers.
 *
 * ── There is no default, and that is the point [1.63.0] ────────────────────────────────────
 *
 * This shipped with `{ Laboratory: 60, Ultrasound: 45, Xray: 30 }` — plausible figures I chose so
 * the chart would have a reference line. On the clinic's own data those render as Ultrasound
 * hitting 7.7% and X-Ray 8.3%, drawn as a benchmark, on a screen an administrator reads as fact.
 *
 * Nobody at the clinic agreed them. A target line is a promise, and inventing one so a chart looks
 * finished is the same error as printing a made-up TIN on a receipt to make it look official —
 * `lib/clinic.js` refuses to do that for exactly this reason, and the refusal is what makes the
 * real value get set.
 *
 * So the default is EMPTY. With nothing configured the chart reports measured medians and a p90
 * and draws no benchmark, which is the truthful state: the clinic is measured and not yet judged.
 * Setting `TURNAROUND_TARGETS=Laboratory:60,Ultrasound:45,Xray:30` turns the benchmark on, and the
 * act of setting it is the clinic deciding what it is promising.
 *
 * A department missing from the map gets a NULL target and a NULL rate — measured, not judged
 * against a promise nobody made. That path already existed; it is now simply the default one.
 */
// [1.163.0] Steven's decision for the clinic: 60 minutes, every department. It stands in for the empty
// default described above. TURNAROUND_TARGETS still overrides it, and TURNAROUND_TARGETS=off judges nothing.
const DEFAULT_TURNAROUND_TARGETS = Object.freeze({ Laboratory: 60, Ultrasound: 60, Xray: 60 });

function parseTargets(raw) {
  if (!raw) return DEFAULT_TURNAROUND_TARGETS;
  const parsed = {};
  for (const pair of String(raw).split(',')) {
    const [name, minutes] = pair.split(':').map((s) => (s || '').trim());
    const value = Number(minutes);
    if (name && Number.isFinite(value) && value > 0) parsed[name] = value;
  }
  // An unparseable setting yields no targets rather than a guess. With the default now empty,
  // "could not read the setting" and "nothing configured" land in the same honest place: measured,
  // unjudged, and visibly missing a benchmark somebody has to supply.
  return parsed;
}

const TURNAROUND_TARGET_MINUTES = parseTargets(process.env.TURNAROUND_TARGETS);

// [1.148.0] Moved here from services/reportService.js: the department worklists read the same
// targets, to flag a test that has waited past its department's, and two parsers of one setting
// would be two answers to one question.
module.exports = { TURNAROUND_TARGET_MINUTES, parseTargets };
