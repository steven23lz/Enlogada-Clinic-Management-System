import React from 'react';
import { cn } from '../../lib/utils';

/**
 * The block that opens every console screen.
 *
 * There wasn't one. Admin's overview began with a dark hero banner, the Receptionist's queue
 * began with a KPI grid, the Cashier's POS began with a filter row and the Diagnostic worklist
 * began with a table — so moving between screens meant re-finding where you were each time, and
 * three of the four never stated what the screen was for. A header is the cheapest orientation
 * an interface can offer, and it costs one line per screen.
 *
 *   eyebrow      the department or section this screen belongs to
 *   title        what the screen is
 *   description  one sentence on what it is for — written for someone on their first week
 *   actions      the screen's primary verb, hard right
 *   meta         small facts about the current view (date, count, last refresh)
 *
 * `variant="hero"` is the dark treatment, kept for the two landing screens (Admin's console and
 * the Client's home) where the page opens on a welcome rather than on work. Every other screen
 * uses the light variant — a dark banner on top of a worklist is a decoration the person using
 * it has to scroll past forty times a shift.
 *
 * ── The title is an <h1>, and there must be exactly one per screen ────────────────────────────
 * It rendered an <h2> for a long time, which meant no console screen had an <h1> at all: the
 * public pages had one, the staff consoles started at level two with nothing above them. Screen
 * readers navigate by heading level, so a document whose outline begins at h2 reads as though its
 * first section has been cut off.
 *
 * Because this is now the page's h1, a screen must render exactly one. That caught a real
 * duplicate: `DateRangeReports` rendered its own PageHeader inside a tab of `ReportsOverview`,
 * which already had one, so that tab printed "Clinic Reports" twice down the page. If a section
 * inside a screen needs a heading, it is a `PanelHeader`, not a second PageHeader.
 */
const PageHeader = ({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
  meta,
  variant = 'default',
  className,
  children,
}) => {
  if (variant === 'hero') {
    return (
      <div
        className={cn(
          'rail-gradient rail-grid relative overflow-hidden rounded-2xl border border-[#2b3a4d] px-6 py-6 text-white sm:px-8 sm:py-7',
          className
        )}
      >
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0 max-w-2xl">
            {eyebrow && (
              <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-micro font-semibold uppercase tracking-[0.14em] text-brand-200 ring-1 ring-inset ring-white/10">
                {Icon && <Icon className="h-3 w-3" />}
                {eyebrow}
              </span>
            )}
            <h1 className="m-0 text-xl font-bold tracking-tight text-white sm:text-2xl">{title}</h1>
            {description && <p className="m-0 mt-1.5 text-note leading-relaxed text-slate-300">{description}</p>}
          </div>
          {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children && <div className="relative mt-5">{children}</div>}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <span className="mb-1 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.14em] text-brand-600">
            {Icon && <Icon className="h-3 w-3" />}
            {eyebrow}
          </span>
        )}
        <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900 sm:text-xl">{title}</h1>
        {description && <p className="m-0 mt-1 max-w-2xl text-note leading-relaxed text-slate-500">{description}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-fine text-slate-500">{meta}</div>}
      </div>
      {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
};

export default PageHeader;
