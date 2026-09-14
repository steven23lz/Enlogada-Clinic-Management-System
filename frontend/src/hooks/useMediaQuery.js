import { useEffect, useState } from 'react';

/**
 * Whether a media query matches, kept current as the window changes. [1.81.0]
 *
 * The patient portal renders its tab list in ONE place: in the header on a wide screen, and in a
 * bar along the bottom on a phone. Rendering both and hiding one with CSS would put every tab name
 * in the page twice — two matches for every spec that clicks a tab, and two Radix lists answering
 * to one set of panels.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches)
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export default useMediaQuery;
