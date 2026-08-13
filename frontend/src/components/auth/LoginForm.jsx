import React, { useState } from 'react';
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
    <Card className="border-gray-100 shadow-lg rounded-2xl border-t-4 border-t-[#769046] bg-white overflow-hidden">
      <CardHeader className="space-y-1.5 pt-6 pb-2 px-6">
        <CardTitle className="text-xl font-bold text-dark-slate">Welcome Back</CardTitle>
        <CardDescription className="text-xs text-gray-500 font-medium">
          Sign in to your dashboard to manage records.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-6 py-4 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="bg-red-50 border border-red-100 text-red-600 rounded-lg p-3 flex items-center space-x-2 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700">Email Address</label>
            <Input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-xl border-gray-200 bg-gray-50/50 focus-visible:ring-[#769046]"
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-gray-700">Password</label>
              <button
                type="button"
                onClick={() => onNavigate('forgot-password')}
                className="text-[11px] font-semibold text-[#769046] hover:underline bg-transparent border-0 cursor-pointer"
              >
                Forgot password?
              </button>
            </div>
            <PasswordInput
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-xl border-gray-200 bg-gray-50/50 focus-visible:ring-[#769046]"
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
            className="w-full bg-primary-hover hover:bg-primary-active text-white py-3 rounded-xl flex items-center justify-center space-x-2 font-semibold text-sm transition-colors border-0 cursor-pointer shadow-md"
          >
            <span>{submitting ? 'Signing in...' : 'Sign In'}</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </form>

        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-gray-100"></div>
          <span className="flex-shrink mx-3 text-[11px] text-gray-400 font-medium">Or continue with Google</span>
          <div className="flex-grow border-t border-gray-100"></div>
        </div>

        {isGoogleAuthConfigured ? (
          <div className="flex justify-center w-full">
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
        ) : (
          <div className="flex items-start space-x-2 rounded-xl border border-amber-100 bg-amber-50 p-3 text-[11px] text-amber-800">
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
      </CardContent>

      <CardFooter className="flex justify-center border-t border-gray-100 py-4 bg-gray-50/50">
        <p className="text-xs text-gray-600 m-0">
          New to Enlogada?{' '}
          <button
            onClick={onSwitchToRegister}
            className="text-[#769046] font-bold hover:underline bg-transparent border-0 p-0 cursor-pointer"
          >
            Create an account
          </button>
        </p>
      </CardFooter>
    </Card>
  );
};

export default LoginForm;
