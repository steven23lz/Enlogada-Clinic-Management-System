import React from 'react';
import { LogoFull } from '../Logo';
import Reveal from './Reveal';

/**
 * Two photographs of the clinic, one laid over the other. [1.84.0] [1.168.0]
 *
 * It was one photo in front of an Aurora panel wider than the photo and offset below it. Steven:
 * "I can see the placeholder of it". The panel showed on three sides as an empty dark slab, which
 * reads as the space where a picture failed to load. Now every surface is a real photograph: the
 * main one, and a second smaller one overlapping its lower corner, framed in white like a print.
 *
 * Without a photo it is the logo card, because the mark always gets a light ground: its green and
 * azure measure only 2.8–4.3:1 on any dark surface.
 *
 * The caption is `text-balance`: on a 360px phone the tracked uppercase line breaks once, and
 * unbalanced it left "2011" alone on the second line.
 */
function Photo({ photo, className }) {
  return (
    <img
      src={photo.src}
      alt={photo.alt}
      loading="lazy"
      decoding="async"
      className={className}
      style={{ objectPosition: photo.position || '50% 50%' }}
    />
  );
}

export default function ClinicShowcase({ photo, inset, caption = 'Serving Bugo since 2011' }) {
  if (!photo) {
    return (
      <Reveal variant="slide-left" className="relative mx-auto w-full max-w-sm">
        <div className="relative mx-auto flex aspect-[4/5] w-[78%] flex-col items-center justify-center gap-5 rounded-2xl border border-line bg-white p-8 text-center">
          <LogoFull className="h-40 sm:h-48" />
          <p className="m-0 text-meta font-semibold uppercase tracking-[0.18em] text-balance text-primary">{caption}</p>
        </div>
      </Reveal>
    );
  }

  return (
    <Reveal variant="slide-left" className={`relative mx-auto w-full max-w-md ${inset ? 'pb-14 pr-10 sm:pb-16 sm:pr-14' : ''}`}>
      <figure className="relative m-0 aspect-[4/5] w-full overflow-hidden rounded-2xl bg-slate-100 shadow-raised">
        <Photo photo={photo} className="h-full w-full object-cover" />
        <figcaption className="absolute left-3 top-3 max-w-[80%] rounded-lg bg-white px-3 py-2 text-center text-meta font-semibold uppercase tracking-[0.18em] text-balance text-primary max-sm:px-2.5 max-sm:py-1.5 max-sm:tracking-[0.1em]">
          {caption}
        </figcaption>
      </figure>
      {inset && (
        <figure className="absolute bottom-0 right-0 m-0 aspect-square w-[46%] overflow-hidden rounded-2xl border-[6px] border-white bg-slate-100 shadow-raised">
          <Photo photo={inset} className="h-full w-full object-cover" />
        </figure>
      )}
    </Reveal>
  );
}
