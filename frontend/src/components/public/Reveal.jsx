import React from 'react';
import { useInView } from '../../hooks/useInView';

/**
 * Reveals its children once they scroll into view. [1.72.0]
 *
 * The motion itself is CSS — the `[data-reveal]` block in index.css, with the timings measured from
 * the reference site — so the reduced-motion rule there makes it instant for anyone who asked for
 * less movement. Nothing in this component needs to know that setting exists.
 *
 *   variant  fade-up | slide-left | slide-right | rise
 *   index    position in a staggered group: each step waits 180 ms longer than the one before
 *
 * Put hover effects on a CHILD, never on this element: it owns `transition` for the reveal, so a
 * hover transform here would inherit the reveal's 700 ms duration and its stagger delay.
 */
export default function Reveal({ as: Tag = 'div', variant = 'fade-up', index = 0, className, style, children, ...rest }) {
  const [ref, inView] = useInView();

  return (
    <Tag
      ref={ref}
      data-reveal={variant}
      data-revealed={inView ? 'true' : 'false'}
      className={className}
      style={{ ...style, '--reveal-i': index }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
