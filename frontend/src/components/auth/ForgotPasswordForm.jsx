import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PasswordInput } from '../ui/password-input';
import AuthField from './AuthField';
import PasswordMeter from './PasswordMeter';
import CodeInput from './CodeInput';
import ResendCode from './ResendCode';
import { MIN_PASSWORD_LENGTH } from '../../lib/passwordStrength';
import { cn } from '../../lib/utils';
import { AlertCircle, ArrowRight, Info, Lock, Mail } from 'lucide-react';

/**
 * Forgot password, on the back of the sign-in card: the address, then the emailed code with a new
 * password, then done. [1.73.0]
 *
 * This replaced a separate page and an emailed LINK. A link carries its secret in the address bar,
 * so it lands in browser history, a forwarded email and a screenshot; and the old page never
 * removed it, so a refresh reopened the reset with a spent token. A code lives in the inbox and in
 * the box it is typed into, nowhere else — and it only works in the browser that asked for it.
 *
 * What the screen says after the address is sent is the same for every address — "if an account
 * uses it" — because whether an address has an account is exactly what this must not reveal.
 */
const ForgotPasswordForm = ({ onBackToSignIn, notice }) => {
  const { forgotPassword, resendCode, resetPassword } = useAuth();
  const [step, setStep] = useState('email'); // 'email' → 'reset' → 'done'
  const [email, setEmail] = useState('');
  const [request, setRequest] = useState(null); // { ticket, resendAfterSeconds }
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [rejections, setRejections] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const passwordField = useRef(null);

  // The hand-over to Sign In after success, cleared if the form goes first.
  const handOver = useRef(null);
  useEffect(() => () => clearTimeout(handOver.current), []);

  const reject = (message) => {
    setError(message);
    setRejections((n) => n + 1);
  };
  const mismatch = confirm.length > 0 && password !== confirm;
  const address = email.trim();

  const requestCode = async (e) => {
    e.preventDefault();
    setError('');
    if (!address) {
      reject('Enter the email address on your account.');
      return;
    }
    setSubmitting(true);
    try {
      setRequest(await forgotPassword(address));
      setStep('reset');
    } catch (err) {
      reject(err);
    } finally {
      setSubmitting(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setError('');
    if (code.length !== 6) {
      reject('Enter all six digits of the code.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      reject(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      reject('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(request.ticket, code, password);
      setStep('done');
      handOver.current = setTimeout(() => onBackToSignIn(address), 2200);
    } catch (err) {
      reject(err);
      setCode('');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setError('');
    try {
      const result = await resendCode(request.ticket);
      return result?.resendAfterSeconds;
    } catch (err) {
      reject(err);
      return undefined;
    }
  };

  const differentEmail = () => {
    setStep('email');
    setRequest(null);
    setCode('');
    setPassword('');
    setConfirm('');
    setError('');
  };

  const errorAlert = error && (
    <div key={rejections} role="alert" className="alert alert-error animate-shake">
      <AlertCircle />
      <span>{error}</span>
    </div>
  );

  if (step === 'done') {
    return (
      <div key="done" role="status" className="py-6 text-center">
        <svg className="auth-check mx-auto h-20 w-20 text-brand-600" viewBox="0 0 52 52" aria-hidden="true">
          <circle cx="26" cy="26" r="24" />
          <path d="M15 27l7 7 15-15" />
        </svg>
        <h2 id="forgot-title" className="m-0 mt-4 text-2xl font-bold tracking-tight text-slate-900">
          Password changed
        </h2>
        <p className="m-0 mt-1 text-note leading-relaxed text-slate-500">
          Every other device has been signed out. Taking you to sign in…
        </p>
      </div>
    );
  }

  if (step === 'reset') {
    return (
      <div key="reset">
        <div className="auth-rise text-center" style={{ '--i': 1 }}>
          <h1 id="forgot-title" className="m-0 text-2xl font-bold tracking-tight text-slate-900">
            Enter the code
          </h1>
          <p className="m-0 mt-1 text-note leading-relaxed text-slate-500">
            If an account uses <span className="break-all font-semibold text-slate-700">{address}</span>, we
            have sent it a 6-digit code. It works for 10 minutes.
          </p>
        </div>

        <form onSubmit={changePassword} className="mt-6 space-y-4">
          {errorAlert}

          <div className="auth-rise" style={{ '--i': 2 }}>
            <label htmlFor="forgot-code" className="mb-1.5 block text-fine font-semibold text-slate-700">
              Verification code
            </label>
            {/* The sixth digit moves on to the new password rather than submitting: there is more
                of this form to fill in. */}
            <CodeInput
              id="forgot-code"
              value={code}
              onChange={setCode}
              onComplete={() => passwordField.current?.focus()}
              disabled={submitting}
              invalid={Boolean(error) && code.length === 0}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
            <AuthField
              id="forgot-new-password"
              label="New Password"
              icon={Lock}
              index={3}
              after={<PasswordMeter id="forgot-password-hint" password={password} />}
            >
              <PasswordInput
                ref={passwordField}
                id="forgot-new-password"
                autoComplete="new-password"
                placeholder="8+ characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby="forgot-password-hint"
                className="h-11 pl-10"
                disabled={submitting}
              />
            </AuthField>
            <AuthField
              id="forgot-confirm-password"
              label="Confirm Password"
              icon={Lock}
              index={3}
              after={
                <p
                  id="forgot-confirm-error"
                  aria-live="polite"
                  className={cn(
                    'm-0 mt-2 text-fine font-semibold text-rose-600 transition-opacity',
                    mismatch ? 'opacity-100' : 'opacity-0'
                  )}
                >
                  {mismatch ? 'Both passwords must match.' : ' '}
                </p>
              }
            >
              <PasswordInput
                id="forgot-confirm-password"
                autoComplete="new-password"
                placeholder="Type it again"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={mismatch || undefined}
                aria-describedby={mismatch ? 'forgot-confirm-error' : undefined}
                className={cn(
                  'h-11 pl-10',
                  mismatch && 'border-rose-300 focus-visible:border-rose-400 focus-visible:ring-rose-500/15'
                )}
                disabled={submitting}
              />
            </AuthField>
          </div>

          <div className="auth-rise pt-1" style={{ '--i': 4 }}>
            <Button type="submit" variant="brand" loading={submitting} size="lg" className="w-full rounded-full">
              <span>Change password</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </form>

        <div className="auth-rise mt-5 space-y-2" style={{ '--i': 5 }}>
          <ResendCode key={request?.ticket} waitSeconds={request?.resendAfterSeconds ?? 60} onResend={resend} disabled={submitting} />
          <p className="m-0 text-center text-note text-slate-500">
            Wrong address?{' '}
            <button type="button" onClick={differentEmail} className="auth-link">
              Use a different email
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div key="email">
      <div className="auth-rise text-center" style={{ '--i': 1 }}>
        <h1 id="forgot-title" className="m-0 text-2xl font-bold tracking-tight text-slate-900">
          Reset your password
        </h1>
        <p className="m-0 mt-1 text-note leading-relaxed text-slate-500">
          Enter the email on your account and we’ll send you a 6-digit code.
        </p>
      </div>

      {notice && (
        <div className="auth-rise alert alert-info mt-5" style={{ '--i': 1 }}>
          <Info />
          <span>{notice}</span>
        </div>
      )}

      <form onSubmit={requestCode} className="mt-6 space-y-4">
        {errorAlert}

        <AuthField id="forgot-email" label="Email Address" icon={Mail} index={2}>
          <Input
            id="forgot-email"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 pl-10"
            disabled={submitting}
          />
        </AuthField>

        <div className="auth-rise pt-1" style={{ '--i': 3 }}>
          <Button type="submit" variant="brand" loading={submitting} size="lg" className="w-full rounded-full">
            <span>Send code</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </form>

      <p className="auth-rise m-0 mt-6 text-center text-note text-slate-500" style={{ '--i': 4 }}>
        Remembered it?{' '}
        <button type="button" onClick={() => onBackToSignIn()} className="auth-link">
          Back to sign in
        </button>
      </p>
    </div>
  );
};

export default ForgotPasswordForm;
