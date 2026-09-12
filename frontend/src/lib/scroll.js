/**
 * Scroll a section of the current page into view by its id. [1.72.0]
 *
 * Smooth, unless the reader asked for reduced motion: a long smooth scroll is exactly the kind of
 * large-area movement that preference is about, so they get the jump instead. The section's own
 * `scroll-margin-top` keeps its heading clear of the floating header.
 *
 * Returns false when there is no such section, so a caller can tell a jump from a no-op.
 */
export function scrollToSection(id) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
  if (!el) return false;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  return true;
}
