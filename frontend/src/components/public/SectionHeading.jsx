import React from 'react';
import { Info } from 'lucide-react';
import Reveal from './Reveal';
import { cn } from '../../lib/utils';

/**
 * The reference site's section header: a small circled mark beside the heading, one line under
 * it. [1.72.0] The circle's rim is `.edge-gradient` — azure into green — rather than a flat grey.
 *
 * `id` goes on the heading so a section can be `aria-labelledby` it.
 */
export default function SectionHeading({ id, icon: Icon = Info, title, subtitle, align = 'center', className }) {
  const centered = align === 'center';

  return (
    <Reveal className={cn('flex flex-col gap-3', centered ? 'items-center text-center' : 'items-start text-left', className)}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="edge-gradient flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-brand-700"
        >
          <Icon className="h-4 w-4" />
        </span>
        <h2 id={id} className="m-0 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {title}
        </h2>
      </div>
      {subtitle && (
        <p className={cn('m-0 max-w-2xl text-sm leading-relaxed text-ink-soft sm:text-base', centered && 'mx-auto')}>
          {subtitle}
        </p>
      )}
    </Reveal>
  );
}
