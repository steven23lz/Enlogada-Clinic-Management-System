import React from 'react';
import { cn } from '../../lib/utils';

/**
 * The dark band each portal screen opens with. [1.81.0]
 *
 * Flat, as Steven chose over Aurora: one solid rail colour, with no gradient, glow or grid. The band
 * is dark in BOTH themes, so everything on it is rail ink (`text-rail-ink-*`, `text-rail-accent`)
 * or white — never a themeable slate, which would turn dark-on-dark the moment the theme flipped.
 * That is the most repeated dark-mode mistake in this codebase; see CLAUDE.md. The hairline is for
 * dark mode, where the band and the page are close to the same colour.
 *
 * `children` are pulled up across the band's lower edge, so the Home tiles read as one object
 * bridging the band and the page, the way the public site's HeroQuickDock bridges its hero.
 */
export default function PortalBand({ eyebrow, title, subtitle, actions, className, children }) {
  return (
    <section className={cn('relative', className)}>
      <div className={cn('rounded-2xl border border-rail-line bg-rail px-5 py-6 sm:px-8 sm:py-7', children && 'pb-16 sm:pb-20')}>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 space-y-1.5">
            {eyebrow && (
              <p className="m-0 text-micro font-semibold uppercase tracking-[0.14em] text-rail-accent">{eyebrow}</p>
            )}
            <h1 className="m-0 break-words text-2xl font-bold tracking-tight text-white md:text-3xl">{title}</h1>
            {subtitle && (
              <p className="m-0 max-w-xl text-note leading-relaxed text-rail-ink-soft">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
      {children && <div className="relative z-10 -mt-12 px-3 sm:-mt-14 sm:px-5">{children}</div>}
    </section>
  );
}
