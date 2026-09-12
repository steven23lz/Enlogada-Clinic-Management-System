import React from 'react';
import { cn } from '../../lib/utils';

/**
 * Soft blurred colour in a section's corners — the reference site's blobs, in the logo's green and
 * azure tints. [1.72.0]
 *
 * Decoration only: hidden from assistive tech, never in the way of a click, and clipped by its own
 * box so a 24rem blob can never make a phone scroll sideways. The parent section must be
 * `relative`. The slow float stops for anyone who asked for reduced motion (index.css).
 */
export default function DecorBlobs({ className }) {
  return (
    <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <span className="decor-blob decor-blob-a" />
      <span className="decor-blob decor-blob-b" />
    </div>
  );
}
