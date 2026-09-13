import React from 'react';
import { LogoFull } from '../Logo';
import Reveal from './Reveal';

/**
 * The reference site's offset panel behind a photograph, with the clinic's logo standing in for
 * the photograph. [1.72.0] Used on Home's About teaser and on the About page.
 *
 * The Aurora panel is wider than the card and runs below it, so it shows on three sides. The full
 * lockup sits on a fixed white card, because the mark always gets a light ground: its green and
 * azure measure only 2.8–4.3:1 on any dark surface. When the clinic sends a photograph of the
 * building, it replaces the card's contents and nothing else changes.
 */
export default function LogoShowcase({ caption = 'Serving Bugo since 2011' }) {
  return (
    <Reveal variant="slide-left" className="relative mx-auto w-full max-w-sm pb-8">
      <div aria-hidden="true" className="aurora absolute inset-x-0 bottom-0 top-[22%] rounded-2xl" />
      <div className="relative mx-auto flex aspect-[4/5] w-[78%] flex-col items-center justify-center gap-5 rounded-2xl bg-white p-8 text-center shadow-raised">
        <LogoFull className="h-40 sm:h-48" />
        <p className="m-0 text-meta font-semibold uppercase tracking-[0.18em] text-primary">{caption}</p>
      </div>
    </Reveal>
  );
}
