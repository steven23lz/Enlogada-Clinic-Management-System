import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import PublicHeader from '../../components/PublicHeader';
import DecorBlobs from '../../components/public/DecorBlobs';
import Logo from '../../components/Logo';
import LoginForm from '../../components/auth/LoginForm';
import RegisterForm from '../../components/auth/RegisterForm';

// The clinic's front door: Sign In and Create Account as the two sides of one card that turns
// over between them. [1.72.0] Option D of the four built for Steven to choose from. It replaced a
// two-column page, a form beside an azure brand panel, with a tab switch on top of the form.
//
// ── Only one form in the document, except while the card turns ─────────────────────────────
//
// During the 850ms turn both sides are mounted, because the turn has to show the side arriving.
// The moment it ends, the other side UNMOUNTS. That is load-bearing: every spec signs in through
// helpers/auth.js, which fills `input[type="password"]` and clicks `button[type="submit"]`, and a
// hidden second form would be a second match for both. The side turning away is `inert` for the
// whole turn, so it can take neither a click nor focus.
//
// ── App's tab decides the side ────────────────────────────────────────────────────────────────
//
// `mode` is App's current tab, so the header's Sign In / Create Account and the links on the card
// move the same state. App renders this without a `key`, so a header click turns the card rather
// than rebuilding the page.

// Keep in step with `.auth-flip` in index.css.
const TURN_MS = 850;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

const AuthPage = ({ mode = 'login', onNavigate }) => {
  // The side that was showing when the last turn finished. While `mode` differs from it, the card
  // is mid-turn and both sides are mounted.
  const [settled, setSettled] = useState(mode);
  const turning = settled !== mode;

  const loginSide = useRef(null);
  const registerSide = useRef(null);

  // Set when the turn was started from ON the card. The link that started it is on the side turning
  // away, which goes inert and then unmounts, so focus would fall to <body>; the arriving side takes
  // it instead, and a screen reader hears its heading. A turn started from the header leaves focus
  // on the header.
  const focusArriving = useRef(false);

  useEffect(() => {
    if (!turning) return undefined;
    const timer = setTimeout(
      () => {
        setSettled(mode);
        if (focusArriving.current) {
          focusArriving.current = false;
          (mode === 'login' ? loginSide : registerSide).current?.focus({ preventScroll: true });
        }
      },
      // Under reduced motion index.css makes the turn instant, so there is nothing to wait for.
      prefersReducedMotion() ? 0 : TURN_MS + 100
    );
    return () => clearTimeout(timer);
  }, [turning, mode]);

  // The card is as tall as the side showing. Both sides are stacked absolutely so they can turn
  // about one axis, which takes them out of flow, so the height is measured: before paint on the
  // first render, so the card never flashes at zero height, and again whenever the side grows or
  // shrinks (an error appearing, the Google button arriving, a larger text size).
  const [height, setHeight] = useState();
  useLayoutEffect(() => {
    const el = (mode === 'login' ? loginSide : registerSide).current;
    if (!el) return undefined;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  const turnTo = (side) => {
    focusArriving.current = true;
    onNavigate(side);
  };

  return (
    <div className="auth-ground relative flex min-h-screen flex-col">
      <DecorBlobs />
      <PublicHeader currentTab={mode} onNavigate={onNavigate} />

      {/* overflow-x-clip: halfway through a turn the near edge of the card is drawn wider than the
          card itself, and on a phone that would scroll the page sideways for a moment. */}
      <main className="relative flex flex-1 items-start justify-center overflow-x-clip px-4 pb-16 pt-6 sm:items-center sm:px-6 sm:py-12">
        <div className="auth-scene w-full max-w-[28rem]">
          <div
            className="auth-flip"
            data-side={mode === 'login' ? 'front' : 'back'}
            data-turning={turning || undefined}
            style={{ height }}
          >
            {(mode === 'login' || settled === 'login') && (
              <section
                ref={loginSide}
                tabIndex={-1}
                aria-labelledby="login-title"
                inert={mode !== 'login'}
                className="auth-face auth-card rounded-2xl px-6 pb-6 pt-7 sm:px-8 sm:pb-7"
              >
                <CardMark />
                <LoginForm onNavigate={onNavigate} onCreateAccount={() => turnTo('register')} />
              </section>
            )}
            {(mode === 'register' || settled === 'register') && (
              <section
                ref={registerSide}
                tabIndex={-1}
                aria-labelledby="register-title"
                inert={mode !== 'register'}
                className="auth-face auth-face-back auth-card rounded-2xl px-6 pb-6 pt-7 sm:px-8 sm:pb-7"
              >
                <CardMark />
                <RegisterForm onSwitchToLogin={() => turnTo('login')} />
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

/** The mark at the top of each side, on a disc that stays white in both themes (`.auth-mark`). */
function CardMark() {
  return (
    <span
      className="auth-rise auth-mark mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
      style={{ '--i': 0 }}
    >
      <Logo className="h-9 w-9" alt="" />
    </span>
  );
}

export default AuthPage;
