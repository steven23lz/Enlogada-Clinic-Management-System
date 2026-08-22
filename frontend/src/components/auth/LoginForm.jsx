import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { GoogleLogin } from '@react-oauth/google';
import { isGoogleAuthConfigured } from '../../config/googleAuth';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PasswordInput } from '../ui/password-input';
import { AlertCircle, ArrowRight } from 'lucide-react';

// Card-only content, no shell/graphic — AuthPage.jsx owns the shared header/footer/graphic
// panel and the login<->register crossfade.
const LoginForm = ({ onSwitchToRegister, onNavigate }) => {
  const { login, googleLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // A configured client ID is not the same as a *working* one. If the serving origin is missing
  // from the OAuth client's "Authorized JavaScript origins", Google answers GET /gsi/button with
  // 403 and the button's iframe stays 0x0 — but GSI still paints its own non-interactive markup,
  // so a Google-looking pill sits there and clicking it does nothing at all. onError never fires
  // (the flow never starts), so nothing tells the user why. Detect the collapsed iframe and show
  // the same explanatory notice as the not-configured case instead of a dead control.
  const googleSlotRef = useRef(null);
  const [googleButtonBroken, setGoogleButtonBroken] = useState(false);

  useEffect(() => {
    if (!isGoogleAuthConfigured) return undefined;
    let cancelled = false;

    // Keeps watching, and can change its mind in BOTH directions.
    //
    // This used to stop at a 5-second deadline and latch `broken` to true for good. Two ways that
    // hid a button that worked. Google's origin allowlist propagates over minutes to hours, so
    // the very first load after a console change legitimately fails and a later one succeeds —
    // latching meant the page kept apologising after the problem had gone. And the iframe
    // measures 0 while the sign-in popup has focus, so clicking the button inside the grace
    // window could itself trip the verdict: sign in successfully, come back, and the control you
    // just used is gone. Reported from the real screen, not found here.
    //
    // So: a grace period before the first verdict, then a slow poll that keeps re-answering the
    // question. A working button is never hidden for longer than one interval.
    const GRACE_MS = 8000;
    const settledAt = Date.now() + GRACE_MS;

    const look = () => {
      if (cancelled) return;
      const iframe = googleSlotRef.current?.querySelector('iframe');
      const rendered = Boolean(iframe && iframe.getBoundingClientRect().height > 0);
      // Before the grace period is up, only good news counts: a 0x0 iframe this early means
      // Google's script has not sized it yet, not that the origin is refused.
      if (rendered) setGoogleButtonBroken(false);
      else if (Date.now() > settledAt) setGoogleButtonBroken(true);
    };

    const fast = setInterval(look, 400);
    // Hand over to a slower cadence once the verdict is meaningful; 400ms forever is a needless
    // wake-up on a page that sits open at a reception desk all day.
    const slowTimer = setTimeout(() => clearInterval(fast), GRACE_MS + 2000);
    const slow = setInterval(look, 3000);

    return () => {
      cancelled = true;
      clearInterval(fast);
      clearInterval(slow);
      clearTimeout(slowTimer);
    };
  }, []);

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

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setSubmitting(true);
    try {
      if (!credentialResponse.credential) {
        throw 'Google did not return a sign-in credential. Please try again.';
      }
      await googleLogin(credentialResponse.credential);
    } catch (err) {
      setError(typeof err === 'string' ? err : err?.message || 'Google login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="space-y-1">
        <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Welcome Back</h1>
        <p className="m-0 text-[13px] leading-relaxed text-slate-500">
          Sign in to your dashboard to manage records.
        </p>
      </div>

      <div className="mt-6 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="alert alert-error">
              <AlertCircle />
              <span>{error}</span>
            </div>
          )}

          {/* htmlFor/id, so the visible label is the field's accessible name and clicking it
              focuses the input. Both were decorative <label> elements with no association — on
              the one screen every single user has to get through. */}
          <div className="space-y-1.5">
            <label htmlFor="login-email" className="mb-1.5 block text-fine font-semibold text-slate-700">
              Email Address
            </label>
            <Input
              id="login-email"
              name="email"
              type="email"
              // Lets a password manager and the browser offer the right value.
              autoComplete="username"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11"
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label htmlFor="login-password" className="mb-1.5 block text-fine font-semibold text-slate-700">
                Password
              </label>
              <button
                type="button"
                onClick={() => onNavigate('forgot-password')}
                className="text-fine font-semibold text-brand-600 hover:underline bg-transparent border-0 cursor-pointer"
              >
                Forgot password?
              </button>
            </div>
            <PasswordInput
              id="login-password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11"
              disabled={submitting}
            />
          </div>

          {/* UI/UX Phase 4: reverses Phase 0's navy choice for this button — this card's
              own top accent bar, heading, and links are all green, and Register's
              sibling submit button is green, so navy here read as mismatched rather
              than as "the brand's second color." */}
          <Button
            type="submit"
            disabled={submitting}
            size="lg"
            className="w-full"
          >
            <span>{submitting ? 'Signing in...' : 'Sign In'}</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </form>

        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-[#e6ebf1]"></div>
          <span className="mx-3 flex-shrink text-fine font-medium text-slate-400">Or continue with Google</span>
          <div className="flex-grow border-t border-[#e6ebf1]"></div>
        </div>

        {isGoogleAuthConfigured && (
          // Kept mounted even once known-broken: the detector measures this slot's iframe, and
          // unmounting it would destroy the evidence. Hidden instead, so no dead control shows.
          <div
            ref={googleSlotRef}
            className={googleButtonBroken ? 'hidden' : 'flex justify-center w-full'}
          >
            {/* Google's Identity Services button takes a pixel width only — it rejects
                percentages, which is why this is a number and not the "100%" that matched
                the form's full-width Sign In button above. 360 is the widest value that
                still fits the card at its narrowest supported layout, and Google caps the
                button at 400px regardless. */}
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setError('Google Sign In was cancelled or failed.')}
              useOneTap={false}
              shape="pill"
              theme="outline"
              text="continue_with"
              width={360}
            />
          </div>
        )}

        {!isGoogleAuthConfigured && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-fine leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-200">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
            <span>
              Google Sign-In is not configured on this installation. Set{' '}
              <code className="font-mono">VITE_GOOGLE_CLIENT_ID</code> in{' '}
              <code className="font-mono">frontend/.env</code> (and{' '}
              <code className="font-mono">GOOGLE_CLIENT_ID</code> in{' '}
              <code className="font-mono">backend/.env</code>), then restart both servers.
              Signing in with an email and password works as usual.
            </span>
          </div>
        )}

        {isGoogleAuthConfigured && googleButtonBroken && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-fine leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-200">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
            <span>
              Google Sign-In is unavailable on this address. The configured client ID does not
              list <code className="font-mono">{window.location.origin}</code> under
              &quot;Authorized JavaScript origins&quot; — add it at{' '}
              <code className="font-mono">console.cloud.google.com/apis/credentials</code> and
              reload. Signing in with an email and password works as usual.
            </span>
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-[13px] text-slate-500">
        New to Enlogada?{' '}
        <button
          onClick={onSwitchToRegister}
          className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-brand-600 hover:underline"
        >
          Create an account
        </button>
      </p>
    </div>
  );
};

export default LoginForm;
