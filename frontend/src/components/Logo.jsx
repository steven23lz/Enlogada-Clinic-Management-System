import React from 'react';
import markSrc from '../assets/Enlogada_Mark.png';
import lockupSrc from '../assets/Enlogada_Logo.png';

/**
 * The clinic's actual logo, supplied by the owner.
 *
 * This replaced a hand-drawn SVG approximation of it. The real mark is four interlocking petals
 * in the clinic's blue and green, and the file carries "2011" — the year the clinic opened —
 * beneath the cross.
 *
 * ── Why there are two of these ────────────────────────────────────────────────────────────────
 *
 * The supplied file is 155x191 portrait with the "2011" baked in. Nearly every placement here is
 * a small SQUARE — `h-9 w-9` in the public header, similar in the sidebar — and at 36px the year
 * renders about six pixels tall: an illegible smudge that also squashes the cross to make room
 * for it. So the file is split at the blank band the artwork already has between the two
 * elements:
 *
 *   Logo      the cross alone, square, trimmed to its own bounding box so a square container
 *             centres the mark instead of centring whitespace. This is what small placements get.
 *   LogoFull  the complete lockup including the year, for somewhere it can be read at size.
 *
 * ── The white background was removed, and only the outer white ────────────────────────────────
 *
 * The original PNG had an alpha channel but a solid white field, which would have printed a white
 * box around the mark on the dark sidebar, the footer and the hero. That was cleared by flood
 * -filling inward from the border rather than deleting every white pixel, because the white cross
 * between the petals and the counters inside "2011" are the logo's own negative space — a global
 * removal would have punched holes through the artwork.
 *
 * `Logo` keeps the same props as the SVG it replaced, so all nine existing call sites are
 * untouched.
 */
const Logo = ({ className = 'w-10 h-10', alt = 'Enlogada Ultrasound & Diagnostic Clinic' }) => (
  <img
    src={markSrc}
    alt={alt}
    // object-contain, not cover: the mark must never be cropped to fill a container whose
    // aspect ratio does not match it.
    className={`${className} object-contain select-none`}
    draggable={false}
  />
);

/** The full lockup, cross over the year. For placements with room to read it. */
export const LogoFull = ({ className = 'h-16', alt = 'Enlogada Ultrasound & Diagnostic Clinic, established 2011' }) => (
  <img
    src={lockupSrc}
    alt={alt}
    className={`${className} object-contain select-none`}
    draggable={false}
  />
);

export default Logo;
