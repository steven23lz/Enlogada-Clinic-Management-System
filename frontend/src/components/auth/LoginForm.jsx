import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { GoogleLogin } from '@react-oauth/google';
import { isGoogleAuthConfigured } from '../../config/googleAuth';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PasswordInput } from '../ui/password-input';
import AuthField from './AuthField';
import { AlertCircle, ArrowRight, Lock, Mail } from 'lucide-react';

// The front of the sign-in card: the form only. AuthPage.jsx owns the card, the turn between its
// two sides and the page around it; `onCreateAccount` asks it to turn over.
const LoginForm = ({ onNavigate, onCreateAccount }) => {
  const { login, googleLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /**
   * The Google button is always shown when a client ID is configured. It is never hidden by us.
   *
   * There WAS a detector here that hid it when it looked dead, and it was wrong about what it
   * was measuring. It asked for `slot.querySelector('iframe')` and treated a missing or 0-height
   * iframe as proof the button had failed — but @react-oauth/google calls
   * `google.accounts.id.renderButton(container)` into a plain <div>, and GSI frequently renders
   * the pill as native DOM with no iframe at all. So on a perfectly working sign-in the query
   * returned null, the check read that as broken, and it hid a button the user had just used.
   * Reported twice from the real screen; not reproducible in a headless browser here, where the
   * origin is refused and the DOM looks different.
   *
   * Two attempts to make the heuristic smarter (a longer grace period, then letting it change
   * its mind in both directions) both missed this, because the premise was wrong rather than the
   * timing. A check that cannot distinguish "no iframe because it rendered natively" from "no
   * iframe because Google refused" is not measuring the thing it claims to measure.
   *
   * What it was guarding against is real: when the origin is refused, GSI still paints a
   * Google-looking pill and clicking it does nothing, because onError never fires — the flow
   * never starts. That is a genuine dead control. But hiding a WORKING button is the worse
   * failure of the two: it removes the sign-in method the user actually has, and it did so
   * repeatedly, where the dead-button case only appears while an origin allowlist propagates.
   *
   * If this needs solving properly it wants a real signal — Google publishing a failure state,
   * or intercepting the 403 on accounts.google.com/gsi/button — not geometry.
   */

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  // Bumped on every rejection so the alert remounts and the shake replays. A boolean would not:
  // two wrong passwords in a row set the same error text, and React would keep the same element.
  const [rejections, setRejections] = useState(0);

  // GSI renders once at the width it is given, so this is measured rather than styled.
  //
  // `clientWidth`, not getBoundingClientRect(). This form can mount while the card is part-way
  // through turning over, and a bounding box measures the PROJECTED shape: at 60 degrees the slot
  // reads half its width, GSI draws a half-width button, and nothing measures it again, because a
  // transform is not a resize. clientWidth is the layout width, which a turn does not change.
  const googleSlot = useRef(null);
  const [googleWidth, setGoogleWidth] = useState(240);
  useEffect(() => {
    const el = googleSlot.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      // 400 is Google's own cap; below that, fill the slot exactly.
      const w = Math.min(400, el.clientWidth);
      if (w > 0) setGoogleWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setSubmitting(true);
    try {
      if (!credentialResponse.credential) {
        throw 'Google did not return a sign-in credential. Please try again.';
      }
      await googleLogin(credentialResponse.credential);
    } catch (err) {
      setRejections((n) => n + 1);
      setError(typeof err === 'string' ? err : err?.message || 'Google login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="auth-rise text-center" style={{ '--i': 1 }}>
        <h1 id="login-title" className="m-0 text-2xl font-bold tracking-tight text-slate-900">
          Welcome back
        </h1>
        <p className="m-0 mt-1 text-note leading-relaxed text-slate-500">
          Sign in to book tests and see your results.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {/* The shake is a head-shake: a rejection, shown as one. It rides ALONGSIDE the red
            border, the icon and the message — never instead of them, because motion says nothing
            to a screen reader or to anyone with reduced motion on, and both still get the whole
            message. Keyed on the rejection count so a second wrong password shakes again rather
            than sitting there looking already-answered. */}
        {error && (
          <div key={rejections} role="alert" className="alert alert-error animate-shake">
            <AlertCircle />
            <span>{error}</span>
          </div>
        )}

        <AuthField id="login-email" label="Email Address" icon={Mail} index={2}>
          <Input
            id="login-email"
            name="email"
            type="email"
            // Lets a password manager and the browser offer the right value.
            autoComplete="username"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 pl-10"
            disabled={submitting}
          />
        </AuthField>

        <AuthField
          id="login-password"
          label="Password"
          icon={Lock}
          index={3}
          action={
            <button type="button" onClick={() => onNavigate('forgot-password')} className="auth-link text-fine">
              Forgot password?
            </button>
          }
        >
          <PasswordInput
            id="login-password"
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 pl-10"
            disabled={submitting}
          />
        </AuthField>

        {/* The page's one call to action, so it takes the public site's gradient. Its name must
            stay exactly "Sign In": failure-states and mobile-patient click the LAST button with
            that name, and the header's is the first. */}
        <div className="auth-rise pt-1" style={{ '--i': 4 }}>
          <Button type="submit" variant="brand" loading={submitting} size="lg" className="w-full rounded-full">
            <span>Sign In</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </form>

      {/* Gated on the same condition as the button inside, so the two always appear together.
          It used to render unconditionally, which left the divider heading an empty gap on any
          deployment that does not configure Google at all. */}
      {isGoogleAuthConfigured && (
        <div className="auth-rise mt-4 space-y-4" style={{ '--i': 5 }}>
          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-line"></div>
            {/* Just "or". The button directly beneath already says "Continue with Google" — that
                wording comes from GSI's `text="continue_with"` and is fixed by Google's branding
                rules, so spelling it out here too printed the same sentence twice, stacked. The
                divider's job is to separate the two ways in, not to name the second one. */}
            <span className="mx-3 flex-shrink text-fine font-medium text-slate-400">or</span>
            <div className="flex-grow border-t border-line"></div>
          </div>

          {/* `min-w-0` + `overflow-hidden` below are load-bearing, not tidiness. GSI renders at a
              fixed pixel width, so without them an oversized button sets its own slot's min-content
              width, which pushes the card, which pushes the page — and the measurement then reads
              that inflated width back and can never converge. Clipped instead, the slot's width is
              dictated by the card, the measurement is honest, and it self-corrects. */}
          <div ref={googleSlot} className="flex w-full min-w-0 justify-center overflow-hidden">
            {/* Google's Identity Services button takes a pixel width only — it rejects
                percentages, which is why this cannot simply be the "100%" that matches the
                form's full-width Sign In button above.

                It was a hard-coded 360, which overflowed: 360 plus the page's own `px-4` is
                392px, so a 390px phone scrolled sideways by exactly 2px. Measuring the slot
                instead makes it match the Sign In button at every width, and it cannot go stale
                the next time the column's max-width changes. Google caps it at 400 regardless. */}
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => { setRejections((n) => n + 1); setError('Google Sign In was cancelled or failed.'); }}
              useOneTap={false}
              shape="pill"
              theme="outline"
              text="continue_with"
              // Google's widget follows the BROWSER's locale, and nothing else in this app does.
              // [1.65.0] On a Philippine machine it rendered "Magpatuloy sa Google" beneath an
              // otherwise entirely English form — one control speaking a different language from
              // the screen around it, decided by a setting the clinic never chose.
              //
              // Pinned rather than left to the browser. If the clinic later wants a Filipino
              // interface that is a decision to take for the whole app, not one Google makes for
              // a single button.
              locale="en"
              width={googleWidth}
            />
          </div>
        </div>
      )}

      {/* No notice about Google, deliberately.

          This used to print, on the public login page, that the client ID "does not list
          http://localhost:5173 under Authorized JavaScript origins — add it at
          console.cloud.google.com". That is a developer's instruction shown to a patient: it
          names an internal address, tells them to open a Google Cloud console they have no
          access to, and reads like the clinic is broken. The same block also fired when Google
          Sign-In was simply never configured, which is not an error at all — it is a
          deployment that does not offer Google.

          Either way the patient's answer is the same and is already on screen: sign in with
          email and password. So the Google section disappears entirely and the page says
          nothing about it. The diagnosis still exists for whoever needs it, in the console,
          where a developer looks and a patient does not.
      */}

      {/* "Create an account", never "Sign up" or "Register": the header's button says Create
          Account, and the two must read as the same way in. */}
      <p className="auth-rise m-0 mt-6 text-center text-note text-slate-500" style={{ '--i': 6 }}>
        New to Enlogada?{' '}
        <button type="button" onClick={onCreateAccount} className="auth-link">
          Create an account
        </button>
      </p>
    </div>
  );
};

export default LoginForm;
