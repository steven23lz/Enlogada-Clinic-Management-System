import React from 'react';
import Logo from '../Logo';
import PatientSwitcher from './PatientSwitcher';
import AccountMenu from './AccountMenu';
import { useScrolled } from '../../hooks/useScrolled';
import { cn } from '../../lib/utils';

/**
 * The portal's header: a solid pill, fixed to the top, that spreads into a full-width bar once the
 * page scrolls. [1.81.0] [1.91.0]
 *
 * Flat, not the public site's frosted glass. No transform and no backdrop-filter either: either
 * one makes an element the containing block for fixed descendants, and the portal's phone tab bar
 * has to stay pinned to the SCREEN, not to this.
 *
 * It spreads the way the public header does [1.88.0], and for the same reason: a pill floating a
 * little below the top edge leaves a strip above and beside it where the page slides past and runs
 * into it. Steven asked for every header to do this. The header's side and top padding moves INTO
 * the bar over the same 300ms, so the logo, the tabs and the chip stay where they were, and the
 * height never changes (12px above the pill becomes 6px above and below the bar).
 *
 * The logo is not a button. The Home tab is already one press away, and two controls that do the
 * same thing side by side are the double Steven notices first.
 */
export default function PortalHeader({ profiles, onNavigate, tabs }) {
  const scrolled = useScrolled(12);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 transition-[padding] duration-300 ease-out motion-reduce:transition-none',
        scrolled ? 'px-0 pt-0' : 'px-3 pt-3 sm:px-5'
      )}
    >
      <div
        data-testid="header-bar"
        className={cn(
          'mx-auto w-full border bg-surface transition-[max-width,border-radius,padding,border-color,box-shadow] duration-300 ease-out motion-reduce:transition-none',
          scrolled
            ? 'max-w-full rounded-none border-x-transparent border-t-transparent border-b-line px-3 py-1.5 sm:px-5'
            : 'max-w-6xl rounded-2xl border-line shadow-float'
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
          <div className="flex min-w-0 flex-shrink-0 items-center gap-2.5">
            <Logo className="h-9 w-9 flex-shrink-0" />
            <div className="hidden min-w-0 flex-col leading-tight sm:flex">
              <span className="truncate text-lead font-bold tracking-tight text-ink">ENLOGADA</span>
              <span className="truncate text-micro font-semibold uppercase tracking-[0.12em] text-ink-muted">
                Patient portal
              </span>
            </div>
          </div>

          {tabs && <div className="flex min-w-0 flex-1 justify-center">{tabs}</div>}

          <div className="ml-auto flex min-w-0 items-center gap-2">
            <PatientSwitcher profiles={profiles} />
            <AccountMenu onNavigate={onNavigate} />
          </div>
        </div>
      </div>
    </header>
  );
}
