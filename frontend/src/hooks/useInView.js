import { useEffect, useRef, useState } from 'react';

/**
 * True once the element has scrolled into view — and then true for good. [1.72.0]
 *
 * Once, not continuously: the public site reveals each section as it arrives, the way the reference
 * design does, and a section that fades back out when it leaves the screen reads as flicker.
 *
 * Starts TRUE wherever IntersectionObserver does not exist, so content can never be stuck invisible
 * waiting for an event that is not coming.
 */
export function useInView({ rootMargin = '0px 0px -10% 0px', threshold = 0.15 } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, rootMargin, threshold]);

  return [ref, inView];
}
