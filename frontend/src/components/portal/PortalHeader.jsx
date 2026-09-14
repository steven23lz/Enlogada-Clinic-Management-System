import React from 'react';
import Logo from '../Logo';
import PatientSwitcher from './PatientSwitcher';
import AccountMenu from './AccountMenu';

/**
 * The portal's header: a solid pill, fixed to the top. [1.81.0]
 *
 * Flat, not the public site's frosted glass. No transform and no backdrop-filter either: either
 * one makes an element the containing block for fixed descendants, and the portal's phone tab bar
 * has to stay pinned to the SCREEN, not to this.
 *
 * The logo is not a button. The Home tab is already one press away, and two controls that do the
 * same thing side by side are the double Steven notices first.
 */
export default function PortalHeader({ profiles, onNavigate, tabs }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-5">
      <div className="mx-auto flex max-w-6xl items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2 shadow-float sm:gap-3 sm:px-4">
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
    </header>
  );
}
