import { useSyncExternalStore } from 'react';

/**
 * How large the interface text is, chosen by whoever is using it.
 *
 * A clinic is exactly the setting where this matters. Reception runs the same screen for a full
 * shift, some staff are working at arm's length from a counter monitor, and the patient portal is
 * read by people who came in for a diagnostic test in the first place. Browser zoom is the usual
 * answer and it is a poor one here: it reflows the layout, it is per-site rather than per-person
 * on a shared terminal, and nobody discovers it.
 *
 * ── Why the root font size, and not a class on every element ──────────────────────────────────
 *
 * Every size in this app is already expressed in `rem` — the custom `--text-micro` … `--text-stat`
 * tokens included — so the browser's root size is the single lever that moves all of it in
 * proportion. Spacing scales with it too, because Tailwind's spacing scale is rem-based, which is
 * what keeps a larger setting looking designed rather than cramped.
 *
 * ── Reading it back before the first paint ────────────────────────────────────────────────────
 *
 * `applyStoredScale()` is called from main.jsx before React mounts. Left to an effect, the app
 * would paint at the default size and then jump, once per load, for exactly the users who chose a
 * larger size because reading is hard for them.
 */

const KEY = 'enlogada:text-scale';

/**
 * Percentages of the browser's own root size rather than fixed pixels, so a user who has already
 * raised their default in the OS or browser keeps that as their baseline and this multiplies it.
 * Overriding with `16px` would quietly UNDO an accessibility setting they had already made.
 */
export const TEXT_SCALES = Object.freeze([
  { id: 'normal', label: 'Normal', percent: 100 },
  { id: 'large', label: 'Large', percent: 112.5 },
  { id: 'larger', label: 'Larger', percent: 125 },
]);

const DEFAULT_ID = 'normal';
const isValid = (id) => TEXT_SCALES.some((s) => s.id === id);

const read = () => {
  try {
    const stored = localStorage.getItem(KEY);
    return isValid(stored) ? stored : DEFAULT_ID;
  } catch {
    // Private windows and locked-down browsers throw on access rather than returning null.
    return DEFAULT_ID;
  }
};

let current = DEFAULT_ID;
const listeners = new Set();

const paint = (id) => {
  const scale = TEXT_SCALES.find((s) => s.id === id) || TEXT_SCALES[0];
  if (typeof document !== 'undefined') {
    document.documentElement.style.fontSize = scale.percent === 100 ? '' : `${scale.percent}%`;
    // Exposed so CSS can adjust anything that should NOT grow with the text — see index.css.
    document.documentElement.dataset.textScale = id;
  }
};

/** Called once from main.jsx, before React renders, so the first paint is already correct. */
export function applyStoredScale() {
  current = read();
  paint(current);
  return current;
}

export function setTextScale(id) {
  if (!isValid(id)) return;
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // A preference that cannot be persisted still applies for this session, which is better than
    // refusing to change size at all.
  }
  paint(id);
  listeners.forEach((fn) => fn());
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const getSnapshot = () => current;

/** The chosen scale, re-rendering the control when it changes. */
export const useTextScale = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
