import React from 'react';
import PageShell from '../ui/page-shell';
import Reveal from './Reveal';

/**
 * The top of every inner public page: an Aurora band under the floating header. [1.72.0]
 *
 * Home opens on a full-height Aurora hero; Services, About, Privacy and Terms open on this shorter
 * version of it, so every public page begins the same way and the glass header always floats over
 * the same surface. The page passes `overlay` to PublicHeader, and the top padding here is what
 * keeps the heading clear of it.
 *
 * Only inks checkContrast.js measures on `.aurora` are used: aurora-ink for the heading and
 * aurora-soft for the eyebrow and the sentence under it. A gradient word in the title
 * (`.text-gradient-aurora`) is display-size only, which is what its 3:1 is measured for.
 *
 *   id        on the h1, so the section is aria-labelledby it
 *   children  anything that belongs in the hero — Services puts its search box here
 */
export default function PageHero({ id, eyebrow, title, subtitle, children }) {
  return (
    <section aria-labelledby={id} className="aurora relative isolate overflow-hidden pb-16 pt-32 sm:pb-20 sm:pt-40">
      <PageShell className="relative flex flex-col items-center text-center">
        {eyebrow && (
          <Reveal as="p" className="m-0 text-meta font-semibold uppercase tracking-[0.2em] text-aurora-soft">
            {eyebrow}
          </Reveal>
        )}
        <Reveal index={1}>
          <h1
            id={id}
            className="m-0 mt-4 max-w-3xl text-3xl font-black leading-tight tracking-tight text-aurora-ink sm:text-5xl"
          >
            {title}
          </h1>
        </Reveal>
        {subtitle && (
          <Reveal as="p" index={2} className="m-0 mt-5 max-w-2xl text-sm leading-relaxed text-aurora-soft sm:text-lg">
            {subtitle}
          </Reveal>
        )}
        {children && (
          <Reveal index={3} className="mt-8 w-full max-w-xl">
            {children}
          </Reveal>
        )}
      </PageShell>
    </section>
  );
}
