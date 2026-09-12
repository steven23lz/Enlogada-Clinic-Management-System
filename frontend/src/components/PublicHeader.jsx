import React, { useEffect, useRef, useState } from 'react';
import Logo from './Logo';
import { useAuth } from '../contexts/AuthContext';
import { useClinic } from '../lib/clinic';
import { useScrolled } from '../hooks/useScrolled';
import { scrollToSection } from '../lib/scroll';
import { LogOut, User, Menu, X, Phone, Mail } from 'lucide-react';
import { ThemeToggle } from './ui/theme-toggle';
import { Button } from './ui/button';
import ContactPopover from './public/ContactPopover';
import { cn } from '../lib/utils';

const NAV_LINKS = [
  { id: 'home', label: 'Home' },
  { id: 'services', label: 'Services' },
  { id: 'about', label: 'About Us' },
];

/**
 * The public site's header: a floating glass pill. [1.72.0]
 *
 * The reference design's navbar — rounded, frosted, floating a little below the top edge — over
 * the Aurora colouring. `overlay` fixes it over a full-height hero (Home); everywhere else it is
 * sticky and takes its own space. Once the page scrolls it tightens and lifts, so it reads as
 * floating over content rather than sitting in the hero.
 *
 * The glass is `.glass-pill`, whose opacity is held by scripts/checkContrast.js: every ink used on
 * it here (ink, ink-soft, brand-700) is measured on the glass composited over the hero's brightest
 * glow. That is why the subtitle is ink-soft and not the lighter ink-muted, which measures 4.46:1
 * there.
 *
 * ── Where the row changes shape, and why there ───────────────────────────────────────────────────
 * Measured at 390–1440px at the default text size AND at "Larger", because a patient's choice in
 * the portal carries over to these pages. The desktop row starts at lg (1024) and stays compact —
 * tighter buttons, Contact as its icon, no FAQ link, no subtitle — until xl (1280). The first
 * version switched at md and lg: at Larger text it overflowed the pill by 35px at 768 and 109px at
 * 1024. The brand never shrinks, so any squeeze shows up as a measurable overflow; an earlier cut
 * let it shrink and the wordmark ran silently under the Home link instead.
 *
 * Below lg the links live in a panel under the pill. A dropdown, not a drawer: this is a short
 * nav, and Phase 1 (2026-08-12) found the unwrapped row overflowing a 375px phone by 131px.
 *
 * ── What the suite holds this file to — keep these when changing it ─────────────────────────────
 *   - The FIRST element reading exactly "Sign In" is the visible desktop button (helpers/auth.js).
 *   - A button named "Open menu" / "Close menu" toggles the phone panel, which carries
 *     data-testid="public-menu". signInOnPhone finds it by that — it used to select
 *     `header div.md:hidden`, which tied a test to a breakpoint and blocked exactly the fix above.
 *   - Exactly one theme toggle while the panel is closed (dark-mode.spec.js). The desktop one lives
 *     INSIDE the lg:flex cluster; as a sibling it would be pinned to the far edge. [1.39.0]
 *   - A button named exactly "Services" (services-fold, failure-states).
 */
const PublicHeader = ({ currentTab = '', onNavigate, overlay = false }) => {
  const { user, logout } = useAuth();
  const CLINIC = useClinic();
  const [menuOpen, setMenuOpen] = useState(false);
  const scrolled = useScrolled(12);
  const headerRef = useRef(null);

  // The phone panel closes the way a menu is expected to: Escape, or a tap anywhere outside it.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const onPointer = (e) => {
      if (!headerRef.current?.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen]);

  const go = (tab) => {
    setMenuOpen(false);
    onNavigate?.(tab);
  };

  // FAQ is a section of Home, not a page: on Home it scrolls there; anywhere else it goes to Home
  // first and App hands the section down. Offered signed-out only — a signed-in patient's "home"
  // is their dashboard, which has no FAQ to scroll to.
  const goFaq = () => {
    setMenuOpen(false);
    if (currentTab === 'home') scrollToSection('faq');
    else onNavigate?.('home', { section: 'faq' });
  };

  const logOut = () => {
    setMenuOpen(false);
    logout();
  };

  const tel = CLINIC.phone.replace(/\s/g, '');
  const navButton = (active) =>
    cn(
      'cursor-pointer whitespace-nowrap rounded-full border-0 px-2 py-1.5 text-note font-semibold transition-colors xl:px-3',
      active ? 'bg-brand-50 text-brand-700' : 'bg-transparent text-ink-soft hover:text-ink'
    );
  const panelButton = (active) =>
    cn(
      'w-full cursor-pointer rounded-lg border-0 px-3 py-2.5 text-left text-sm font-semibold',
      active ? 'bg-brand-50 text-brand-700' : 'bg-transparent text-ink-soft hover:bg-sunken'
    );

  return (
    <header
      ref={headerRef}
      className={cn('z-50 w-full px-3 pt-3 sm:px-4', overlay ? 'fixed inset-x-0 top-0' : 'sticky top-0')}
    >
      <div
        className={cn(
          'glass-pill mx-auto flex w-full max-w-6xl items-center justify-between gap-2 rounded-full pl-2.5 pr-2 transition-[box-shadow,padding] duration-300 sm:pl-3',
          scrolled ? 'py-1.5 shadow-float' : 'py-2 shadow-raised'
        )}
      >
        {/* Brand. The mark sits on a white chip in both themes: the logo's green and azure measure
            only 2.8–4.3:1 on a dark ground, so it always gets a light one. */}
        <button
          type="button"
          onClick={() => go('home')}
          className="flex flex-shrink-0 cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left"
        >
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white">
            <Logo className="h-7 w-7" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-lead font-bold tracking-tight text-ink">ENLOGADA</span>
            {/* Beside the burger there is room for it; on the compact desktop row there is not. */}
            <span className="hidden text-micro font-semibold uppercase tracking-[0.12em] text-ink-soft sm:block lg:hidden xl:block">
              Ultrasound &amp; Diagnostic Clinic
            </span>
          </span>
        </button>

        {/* Desktop */}
        <div className="hidden items-center gap-1 lg:flex xl:gap-1.5">
          <nav aria-label="Main" className="flex items-center gap-0.5">
            {NAV_LINKS.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => go(link.id)}
                aria-current={currentTab === link.id ? 'page' : undefined}
                className={navButton(currentTab === link.id)}
              >
                {link.label}
              </button>
            ))}
            {!user && (
              <button type="button" onClick={goFaq} className={cn(navButton(false), 'hidden xl:inline-flex')}>
                FAQ
              </button>
            )}
          </nav>

          <ContactPopover />

          <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
          <ThemeToggle className="rounded-full" />

          {user ? (
            <>
              <button
                type="button"
                onClick={() => go('dashboard')}
                className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-fine font-semibold text-ink transition-colors hover:bg-sunken"
              >
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                  <User className="h-3.5 w-3.5" />
                </span>
                <span className="whitespace-nowrap">{user.firstName}</span>
              </button>
              <button
                type="button"
                onClick={logOut}
                className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-fine font-semibold text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Log Out</span>
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => go('login')} className={navButton(false)}>
                Sign In
              </button>
              <Button variant="brand" size="sm" onClick={() => go('register')} className="rounded-full px-3.5 xl:px-4">
                Create Account
              </Button>
            </>
          )}
        </div>

        {/* Phone and tablet toggle */}
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="public-menu"
          className="flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-ink-soft transition-colors hover:text-ink lg:hidden"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* The panel. Full width on a phone; on a tablet a dropdown under the right end of the pill,
          because a sheet the width of an iPad for four links reads as a page, not a menu. */}
      {menuOpen && (
        <div className="mx-auto mt-2 flex max-w-6xl justify-end lg:hidden">
          <div
            id="public-menu"
            data-testid="public-menu"
            className="animate-fade-in w-full space-y-1 rounded-2xl border border-line bg-surface p-3 shadow-float sm:max-w-sm"
          >
            <div className="flex items-center justify-between gap-2 px-1 pb-2">
              <span className="text-fine font-semibold text-ink-muted">Appearance</span>
              <ThemeToggle className="rounded-full" />
            </div>

            {NAV_LINKS.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => go(link.id)}
                aria-current={currentTab === link.id ? 'page' : undefined}
                className={panelButton(currentTab === link.id)}
              >
                {link.label}
              </button>
            ))}
            {!user && (
              <button type="button" onClick={goFaq} className={panelButton(false)}>
                FAQ
              </button>
            )}

            {/* The contact popover's content, inline — a popover inside a dropdown is one layer too
                many on a phone, and a phone is where "tap to call" is most useful. */}
            <div className="mt-2 space-y-1 border-t border-line pt-2">
              <a
                href={`tel:${tel}`}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold text-ink-soft no-underline hover:bg-sunken"
              >
                <Phone className="h-4 w-4 flex-shrink-0 text-brand-700" aria-hidden="true" />
                {CLINIC.phone}
              </a>
              <a
                href={`mailto:${CLINIC.email}`}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold text-ink-soft no-underline [overflow-wrap:anywhere] hover:bg-sunken"
              >
                <Mail className="h-4 w-4 flex-shrink-0 text-brand-700" aria-hidden="true" />
                {CLINIC.email}
              </a>
            </div>

            <div className="mt-2 space-y-2 border-t border-line pt-3">
              {user ? (
                <>
                  <button
                    type="button"
                    onClick={() => go('dashboard')}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-sunken"
                  >
                    <User className="h-4 w-4" />
                    <span>{user.firstName}&apos;s Dashboard</span>
                  </button>
                  <button
                    type="button"
                    onClick={logOut}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink-soft hover:bg-sunken"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Log Out</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => go('login')}
                    className="w-full cursor-pointer rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-sunken"
                  >
                    Sign In
                  </button>
                  <Button variant="brand" onClick={() => go('register')} className="h-11 w-full rounded-full text-sm">
                    Create Account
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default PublicHeader;
