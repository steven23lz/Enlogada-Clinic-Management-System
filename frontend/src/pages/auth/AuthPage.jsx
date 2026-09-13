import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import PublicHeader from '../../components/PublicHeader';
import DecorBlobs from '../../components/public/DecorBlobs';
import Logo from '../../components/Logo';
import LoginForm from '../../components/auth/LoginForm';
import RegisterForm from '../../components/auth/RegisterForm';
import ForgotPasswordForm from '../../components/auth/ForgotPasswordForm';

// The clinic's front door: one card that turns over. [1.72.0] Sign In is the front; the back is
// Create Account or Forgot Password [1.73.0]. Option D of the four built for Steven to choose from.
//
// ── Only one form in the document, except while the card turns ─────────────────────────────
//
// During the 850ms turn both sides are mounted, because the turn has to show the side arriving.
// The moment it ends, the other side UNMOUNTS. That is load-bearing: every spec signs in through
// helpers/auth.js, which fills `input[type="password"]` and clicks `button[type="submit"]`, and a
// hidden second form would be a second match for both. The side turning away is `inert` for the
// whole turn, so it can take neither a click nor focus. The steps inside a side (details, then the
// emailed code) replace one another, so they never add a second form either.
//
// ── App's tab decides the side ────────────────────────────────────────────────────────────────
//
// `mode` is App's current tab — 'login', 'register' or 'forgot-password' — so the header's buttons
// and the links on the card move the same state. App renders this without a `key`, so a header
// click turns the card rather than rebuilding the page.

// Keep in step with `.auth-flip` in index.css.
const TURN_MS = 850;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

const sideOf = (mode) => (mode === 'login' ? 'front' : 'back');

const AuthPage = ({ mode = 'login', onNavigate, notice }) => {
  const side = sideOf(mode);

  // The side that was showing when the last turn finished. While `side` differs from it, the card
  // is mid-turn and both sides are mounted.
  const [settledSide, setSettledSide] = useState(side);
  const turning = settledSide !== side;

  // What the back shows. Kept while the card turns back to Sign In, so the side turning away does
  // not change under the turn. Updated during render, React's pattern for state derived from a
  // prop, so the back never shows the previous form for a frame.
  const [backMode, setBackMode] = useState(mode === 'login' ? 'register' : mode);
  if (mode !== 'login' && mode !== backMode) setBackMode(mode);

  // A reset hands its address to Sign In, so the person only has to type the new password.
  const [prefillEmail, setPrefillEmail] = useState('');

  const frontSide = useRef(null);
  const backSide = useRef(null);

  // Set when the turn was started from ON the card. The link that started it is on the side turning
  // away, which goes inert and then unmounts, so focus would fall to <body>; the arriving side takes
  // it instead, and a screen reader hears its heading. A turn started from the header leaves focus
  // on the header.
  const focusArriving = useRef(false);

  useEffect(() => {
    if (!turning) return undefined;
    const timer = setTimeout(
      () => {
        setSettledSide(side);
        if (focusArriving.current) {
          focusArriving.current = false;
          (side === 'front' ? frontSide : backSide).current?.focus({ preventScroll: true });
        }
      },
      // Under reduced motion index.css makes the turn instant, so there is nothing to wait for.
      prefersReducedMotion() ? 0 : TURN_MS + 100
    );
    return () => clearTimeout(timer);
  }, [turning, side]);

  // The card is as tall as the side showing. Both sides are stacked absolutely so they can turn
  // about one axis, which takes them out of flow, so the height is measured: before paint on the
  // first render, so the card never flashes at zero height, and again whenever the side grows or
  // shrinks (an error, the next step, the Google button arriving, a larger text size).
  const [height, setHeight] = useState();
  useLayoutEffect(() => {
    const el = (side === 'front' ? frontSide : backSide).current;
    if (!el) return undefined;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [side]);

  const turnTo = (next) => {
    focusArriving.current = true;
    onNavigate(next);
  };

  const backToSignIn = (email) => {
    if (email) setPrefillEmail(email);
    turnTo('login');
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
            data-side={side}
            data-turning={turning || undefined}
            style={{ height }}
          >
            {(side === 'front' || settledSide === 'front') && (
              <section
                ref={frontSide}
                tabIndex={-1}
                aria-labelledby="login-title"
                inert={side !== 'front'}
                className="auth-face auth-card rounded-2xl px-6 pb-6 pt-7 sm:px-8 sm:pb-7"
              >
                <CardMark />
                <LoginForm
                  initialEmail={prefillEmail}
                  onForgotPassword={() => turnTo('forgot-password')}
                  onCreateAccount={() => turnTo('register')}
                />
              </section>
            )}
            {(side === 'back' || settledSide === 'back') && (
              <section
                ref={backSide}
                tabIndex={-1}
                aria-labelledby={backMode === 'register' ? 'register-title' : 'forgot-title'}
                inert={side !== 'back'}
                className="auth-face auth-face-back auth-card rounded-2xl px-6 pb-6 pt-7 sm:px-8 sm:pb-7"
              >
                <CardMark />
                {backMode === 'register' ? (
                  <RegisterForm key="register" onSwitchToLogin={() => turnTo('login')} />
                ) : (
                  <ForgotPasswordForm key="forgot" notice={notice} onBackToSignIn={backToSignIn} />
                )}
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
