import React from 'react';
import Reveal from './Reveal';
import { cn } from '../../lib/utils';

/**
 * One reason to trust the clinic: an icon, a title, a sentence. [1.72.0]
 *
 * The card rises into place with the reference site's spring (`rise`), staggered by `index`. The
 * hover lift lives on the inner article, not on the Reveal wrapper — the wrapper's transition
 * belongs to the reveal, and a hover transform there would move at its 650 ms pace.
 */
export default function FeatureCard({ icon: Icon, title, children, index = 0, className }) {
  return (
    <Reveal variant="rise" index={index} className="h-full">
      <article
        className={cn(
          'edge-gradient flex h-full flex-col rounded-xl p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-raised sm:p-6',
          className
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-linear-to-br from-brand-100 to-azure-100 text-brand-700"
        >
          <Icon className="h-5 w-5" />
        </span>
        <h3 className="m-0 mt-4 text-lead font-bold tracking-tight text-ink">{title}</h3>
        <p className="m-0 mt-1.5 text-note leading-relaxed text-ink-soft">{children}</p>
      </article>
    </Reveal>
  );
}
