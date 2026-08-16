import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { GoogleLogin } from '@react-oauth/google';
import { isGoogleAuthConfigured } from '../../config/googleAuth';
import { Button } from '../ui/button';
import { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription } from '../ui/card';
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
    // Poll rather than check once: on a cold load the iframe legitimately measures 0x0 for a
    // moment before Google's script sizes it.
    const deadline = Date.now() + 5000;
    const timer = setInterval(() => {
      if (cancelled) return;
      const iframe = googleSlotRef.current?.querySelector('iframe');
      const rendered = iframe && iframe.getBoundingClientRect().height > 0;
      if (rendered) {
        clearInterval(timer);
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        setGoogleButtonBroken(true);
      }
    }, 400);
    return () => { cancelled = true; clearInterval(timer); };
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
    <Card className="overflow-hidden rounded-2xl border-[#e6ebf1] shadow-raised">
      <CardHeader className="space-y-1 px-6 pb-2 pt-6">
        <CardTitle className="text-xl font-bold tracking-tight text-slate-900">Welcome Back</CardTitle>
        <CardDescription className="text-[13px] text-slate-500">
          Sign in to your dashboard to manage records.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-6 py-4 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="alert alert-error">
              <AlertCircle />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-fine font-semibold text-slate-700">Email Address</label>
            <Input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10"
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-fine font-semibold text-slate-700">Password</label>
              <button
                type="button"
                onClick={() => onNavigate('forgot-password')}
                className="text-fine font-semibold text-brand-600 hover:underline bg-transparent border-0 cursor-pointer"
              >
                Forgot password?
              </button>
            </div>
            <PasswordInput
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10"
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
      </CardContent>

      <CardFooter className="flex justify-center border-t border-[#e6ebf1] py-4 bg-slate-50/70">
        <p className="text-xs text-gray-600 m-0">
          New to Enlogada?{' '}
          <button
            onClick={onSwitchToRegister}
            className="text-brand-600 font-bold hover:underline bg-transparent border-0 p-0 cursor-pointer"
          >
            Create an account
          </button>
        </p>
      </CardFooter>
    </Card>
  );
};

export default LoginForm;
