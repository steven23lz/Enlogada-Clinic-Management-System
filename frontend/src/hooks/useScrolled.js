import { useEffect, useState } from 'react';

/**
 * True once the page has scrolled past `threshold` pixels. [1.72.0]
 *
 * The public header uses it to tighten and lift once it is floating over content rather than over
 * the hero. A passive listener, and React bails out of a setState that does not change the value,
 * so scrolling re-renders the header only at the moment the answer flips — not on every frame.
 */
export function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(() => typeof window !== 'undefined' && window.scrollY > threshold);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [threshold]);

  return scrolled;
}
