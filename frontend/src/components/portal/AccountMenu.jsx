import React, { useEffect, useRef, useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { ThemeToggle } from '../ui/theme-toggle';
import TextScaleControl from '../ui/text-scale-control';

/**
 * The patient's own corner of the header: who is signed in, and what they can change. [1.81.0]
 *
 * One button (their initials) opens one small panel: My Account, the theme, the text size and Sign
 * out. The old bar showed all of them all the time, beside a name button and a second way into the
 * same account page, which at 390px pushed the portal's own navigation off the screen.
 *
 * It closes the way the public site's menu does: Escape, or a press anywhere outside it. The text
 * size control's own list opens INSIDE this panel, so choosing a size does not count as outside.
 */
export default function AccountMenu({ onNavigate }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onPointer = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  if (!user) return null;
  const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || '?';

  return (
    <div ref={wrap} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-controls="account-menu"
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-brand-200 bg-brand-100 text-fine font-bold text-brand-700 transition-colors hover:bg-brand-200"
      >
        {initials}
      </button>

      {open && (
        <div
          id="account-menu"
          data-testid="account-menu"
          className="animate-fade-in absolute right-0 top-11 z-50 w-72 max-w-[calc(100vw-1.5rem)] space-y-3 rounded-xl border border-line bg-surface p-3 shadow-float"
        >
          <div className="min-w-0 px-1">
            <p className="m-0 truncate text-note font-bold text-ink">{user.firstName} {user.lastName}</p>
            {user.email && <p className="m-0 truncate text-fine text-ink-muted">{user.email}</p>}
          </div>

          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => { setOpen(false); onNavigate?.('account'); }}
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            My Account
          </Button>

          <div className="flex items-center justify-between gap-2 border-t border-line px-1 pt-3">
            <span className="text-fine font-medium text-ink-muted">Theme and text size</span>
            <span className="flex items-center gap-2">
              <ThemeToggle />
              <TextScaleControl />
            </span>
          </div>

          <Button
            variant="ghost"
            className="w-full justify-start text-rose-700 hover:bg-rose-50 hover:text-rose-800"
            onClick={logout}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </Button>
        </div>
      )}
    </div>
  );
}
