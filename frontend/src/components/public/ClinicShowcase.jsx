import React from 'react';
import { LogoFull } from '../Logo';
import Reveal from './Reveal';

/**
 * A photograph of the clinic on the reference site's offset panel. [1.84.0]
 *
 * This was LogoShowcase: the clinic's logo on a white card, standing in for a photograph until the
 * clinic sent some. Given a `photo`, it shows the photograph instead, filling the same 4:5 card,
 * with the caption on a white label. Without one it is the logo card as before, because the mark
 * always gets a light ground: its green and azure measure only 2.8–4.3:1 on any dark surface.
 *
 * The Aurora panel is wider than the card and runs below it, so it shows on three sides.
 */
export default function ClinicShowcase({ photo, caption = 'Serving Bugo since 2011' }) {
  return (
    <Reveal variant="slide-left" className="relative mx-auto w-full max-w-sm pb-8">
      <div aria-hidden="true" className="aurora absolute inset-x-0 bottom-0 top-[22%] rounded-2xl" />
      {photo ? (
        <figure className="relative m-0 mx-auto aspect-[4/5] w-[78%] overflow-hidden rounded-2xl bg-white shadow-raised">
          <img
            src={photo.src}
            alt={photo.alt}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            style={{ objectPosition: photo.position || '50% 50%' }}
          />
          <figcaption className="absolute inset-x-3 bottom-3 rounded-lg bg-white px-3 py-2 text-center text-meta font-semibold uppercase tracking-[0.18em] text-primary">
            {caption}
          </figcaption>
        </figure>
      ) : (
        <div className="relative mx-auto flex aspect-[4/5] w-[78%] flex-col items-center justify-center gap-5 rounded-2xl bg-white p-8 text-center shadow-raised">
          <LogoFull className="h-40 sm:h-48" />
          <p className="m-0 text-meta font-semibold uppercase tracking-[0.18em] text-primary">{caption}</p>
        </div>
      )}
    </Reveal>
  );
}
