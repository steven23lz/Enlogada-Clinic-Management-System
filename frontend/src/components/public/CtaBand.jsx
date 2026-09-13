import React from 'react';
import PageShell from '../ui/page-shell';
import Reveal from './Reveal';

/**
 * The closing call to action on a public page: an Aurora panel, a question, and what to do about
 * it. [1.72.0] Home, Services and About each end on one, so they are one component — three copies
 * of the same panel drift apart the first time one is touched.
 *
 * `children` are the actions, laid out in a row that stacks on a phone. Use `<Button variant="brand">`
 * for the main one and `variant="glass"` (or the GLASS_LINK classes, for a link) beside it: both
 * are measured on this surface.
 */
export default function CtaBand({ id, title, body, children }) {
  return (
    <PageShell as="section" aria-labelledby={id} className="py-20 sm:py-24">
      <Reveal className="aurora relative overflow-hidden rounded-2xl px-6 py-12 text-center sm:px-12 sm:py-16">
        <h2 id={id} className="m-0 text-2xl font-bold tracking-tight text-aurora-ink sm:text-3xl">
          {title}
        </h2>
        {body && (
          <p className="m-0 mx-auto mt-3 max-w-xl text-sm leading-relaxed text-aurora-soft sm:text-base">{body}</p>
        )}
        {children && (
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">{children}</div>
        )}
      </Reveal>
    </PageShell>
  );
}

/** A LINK styled as the glass button, for an action that is an address (tel:, mailto:, a map). */
export const GLASS_LINK =
  'inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/40 bg-white/10 px-7 text-sm font-semibold text-aurora-ink no-underline backdrop-blur-sm transition-colors hover:bg-white/20';
