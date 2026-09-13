import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PasswordInput } from '../ui/password-input';
import AuthField from './AuthField';
import PasswordMeter from './PasswordMeter';
import CodeInput from './CodeInput';
import ResendCode from './ResendCode';
import { MIN_PASSWORD_LENGTH } from '../../lib/passwordStrength';
import { toastSuccess } from '../../lib/toast';
import { cn } from '../../lib/utils';
import { AlertCircle, ArrowRight, Lock, Mail, Phone, User } from 'lucide-react';

// A sign-up waiting for its code, kept for this tab only. Reloading — or a phone discarding the tab
// while the person fetches the code from their email — brings them back to the code, not to an
// empty form. The ticket is useless without the code, and gone when the tab closes. [1.73.0]
const PENDING_KEY = 'enlogada:pending-signup';
const PENDING_TTL_MS = 60 * 60 * 1000;

const readPending = () => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    return saved && Date.now() - saved.savedAt < PENDING_TTL_MS ? saved : null;
  } catch {
    return null;
  }
};

const writePending = (value) => {
  try {
    if (value) sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage blocked: the code step still works, it just does not survive a reload */
  }
};

// The back of the sign-in card, Create Account: the details, then the code emailed to the
// address. [1.73.0] Nothing exists until the code is entered — the server keeps the details as a
// pending sign-up, and the right code turns them into an account and signs it in. AuthPage.jsx owns
// the card; `onSwitchToLogin` turns it back over.
const RegisterForm = ({ onSwitchToLogin }) => {
  const { register, verifySignup, resendCode } = useAuth();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    contactNumber: ''
  });
  const [pending, setPending] = useState(readPending);
  const [resendWait, setResendWait] = useState(60);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Counts rejections rather than holding a flag, so React sees a NEW element each time and
  // replays the shake. A boolean would sit there already-true and the second wrong attempt would
  // look like nothing happened.
  const [rejections, setRejections] = useState(0);

  const update = (field) => (e) => setFormData((d) => ({ ...d, [field]: e.target.value }));
  const reject = (message) => {
    setError(message);
    setRejections((n) => n + 1);
  };
  const remember = (value) => {
    setPending(value);
    writePending(value);
  };

  // Said while they type, not after they submit. The mismatch is the one error on this form the
  // browser can detect without asking the server, and finding out at submit time means retyping
  // a password they already typed twice.
  const passwordsMismatch =
    formData.confirmPassword.length > 0 && formData.password !== formData.confirmPassword;

  const handleDetails = async (e) => {
    e.preventDefault();
    setError('');

    const { firstName, lastName, email, password, confirmPassword, contactNumber } = formData;

    if (!firstName || !lastName || !email || !password) {
      reject('Please fill in all required fields.');
      return;
    }

    // The server's one password rule, checked here as well so the answer arrives where the meter
    // already said it rather than after a round trip. The server's own words.
    if (password.length < MIN_PASSWORD_LENGTH) {
      reject(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    if (password !== confirmPassword) {
      reject('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const started = await register({ firstName, lastName, email, password, contactNumber });
      remember({ ticket: started.ticket, email: started.email, firstName: firstName.trim(), savedAt: Date.now() });
      setResendWait(started.resendAfterSeconds ?? 60);
      setCode('');
    } catch (err) {
      reject(err);
    } finally {
      setSubmitting(false);
    }
  };

  // Called with the code itself by CodeInput on the sixth digit, so it never reads a stale value.
  const handleVerify = async (value = code) => {
    if (value.length !== 6) {
      reject('Enter all six digits of the code.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await verifySignup(pending.ticket, value);
      writePending(null);
      // The session has landed, so the app is already moving to the portal and this form is on its
      // way out. The toast outlives it and says what just happened, by name.
      toastSuccess(`Welcome, ${pending.firstName}. Your account is ready.`);
    } catch (err) {
      reject(err);
      setCode('');
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setError('');
    try {
      const result = await resendCode(pending.ticket);
      return result?.resendAfterSeconds;
    } catch (err) {
      reject(err);
      return undefined;
    }
  };

  // Back to the details, still filled in, to correct the address.
  const startOver = () => {
    remember(null);
    setCode('');
    setError('');
  };

  const errorAlert = error && (
    <div key={rejections} role="alert" className="alert alert-error animate-shake">
      <AlertCircle />
      <span>{error}</span>
    </div>
  );

  if (pending) {
    return (
      <div key="code">
        <div className="auth-rise text-center" style={{ '--i': 1 }}>
          <h1 id="register-title" className="m-0 text-2xl font-bold tracking-tight text-slate-900">
            Check your email
          </h1>
          <p className="m-0 mt-1 text-note leading-relaxed text-slate-500">
            We sent a 6-digit code to{' '}
            <span className="break-all font-semibold text-slate-700">{pending.email}</span>. Enter it to finish
            creating your account.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleVerify();
          }}
          className="mt-6 space-y-4"
        >
          {errorAlert}

          <div className="auth-rise" style={{ '--i': 2 }}>
            <label htmlFor="register-code" className="mb-1.5 block text-fine font-semibold text-slate-700">
              Verification code
            </label>
            <CodeInput
              id="register-code"
              value={code}
              onChange={setCode}
              onComplete={handleVerify}
              disabled={submitting}
              invalid={Boolean(error)}
              autoFocus
            />
          </div>

          <div className="auth-rise pt-1" style={{ '--i': 3 }}>
            <Button type="submit" variant="brand" loading={submitting} size="lg" className="w-full rounded-full">
              <span>Confirm email</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </form>

        <div className="auth-rise mt-5 space-y-2" style={{ '--i': 4 }}>
          <ResendCode key={pending.ticket} waitSeconds={resendWait} onResend={handleResend} disabled={submitting} />
          <p className="m-0 text-center text-note text-slate-500">
            Wrong address?{' '}
            <button type="button" onClick={startOver} className="auth-link">
              Use a different email
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div key="details">
      <div className="auth-rise text-center" style={{ '--i': 1 }}>
        <h1 id="register-title" className="m-0 text-2xl font-bold tracking-tight text-slate-900">
          Create your account
        </h1>
        <p className="m-0 mt-1 text-note leading-relaxed text-slate-500">
          One minute, and you can book tests and receive results online.
        </p>
      </div>

      <form onSubmit={handleDetails} className="mt-6 space-y-4">
        {errorAlert}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
          <AuthField id="registerform-first-name" label="First Name" icon={User} index={2}>
            <Input
              id="registerform-first-name"
              type="text"
              autoComplete="given-name"
              placeholder="Juan"
              value={formData.firstName}
              onChange={update('firstName')}
              className="h-11 pl-10"
              disabled={submitting}
            />
          </AuthField>
          <AuthField id="registerform-last-name" label="Last Name" icon={User} index={2}>
            <Input
              id="registerform-last-name"
              type="text"
              autoComplete="family-name"
              placeholder="Dela Cruz"
              value={formData.lastName}
              onChange={update('lastName')}
              className="h-11 pl-10"
              disabled={submitting}
            />
          </AuthField>
        </div>

        <AuthField id="registerform-email-address" label="Email Address" icon={Mail} index={3}>
          <Input
            id="registerform-email-address"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={formData.email}
            onChange={update('email')}
            className="h-11 pl-10"
            disabled={submitting}
          />
        </AuthField>

        <AuthField id="registerform-contact-number" label="Contact Number" icon={Phone} index={4}>
          <Input
            id="registerform-contact-number"
            type="tel"
            autoComplete="tel"
            placeholder="09171234567"
            value={formData.contactNumber}
            onChange={update('contactNumber')}
            className="h-11 pl-10"
            disabled={submitting}
          />
        </AuthField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
          <AuthField
            id="registerform-password"
            label="Password"
            icon={Lock}
            index={5}
            after={<PasswordMeter id="registerform-password-hint" password={formData.password} />}
          >
            <PasswordInput
              id="registerform-password"
              autoComplete="new-password"
              placeholder="8+ characters"
              value={formData.password}
              onChange={update('password')}
              aria-describedby="registerform-password-hint"
              className="h-11 pl-10"
              disabled={submitting}
            />
          </AuthField>
          <AuthField
            id="registerform-confirm-password"
            label="Confirm Password"
            icon={Lock}
            index={5}
            after={
              // aria-live, so someone who cannot see the red border is still told — and polite
              // rather than assertive, because this fires on a keystroke and must not interrupt
              // what they are typing.
              <p
                id="registerform-confirm-error"
                aria-live="polite"
                className={cn(
                  'm-0 mt-2 text-fine font-semibold text-rose-600 transition-opacity',
                  passwordsMismatch ? 'opacity-100' : 'opacity-0'
                )}
              >
                {passwordsMismatch ? 'Both passwords must match.' : ' '}
              </p>
            }
          >
            <PasswordInput
              id="registerform-confirm-password"
              autoComplete="new-password"
              placeholder="Type it again"
              value={formData.confirmPassword}
              onChange={update('confirmPassword')}
              aria-invalid={passwordsMismatch || undefined}
              aria-describedby={passwordsMismatch ? 'registerform-confirm-error' : undefined}
              className={cn(
                'h-11 pl-10',
                passwordsMismatch && 'border-rose-300 focus-visible:border-rose-400 focus-visible:ring-rose-500/15'
              )}
              disabled={submitting}
            />
          </AuthField>
        </div>

        <div className="auth-rise pt-1" style={{ '--i': 6 }}>
          <Button type="submit" variant="brand" loading={submitting} size="lg" className="w-full rounded-full">
            <span>Create Account</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </form>

      {/* "Sign in instead", never a bare "Sign In": the specs click the LAST button named exactly
          Sign In and expect the submit on the other side of the card. */}
      <p className="auth-rise m-0 mt-6 text-center text-note text-slate-500" style={{ '--i': 7 }}>
        Already have an account?{' '}
        <button type="button" onClick={onSwitchToLogin} className="auth-link">
          Sign in instead
        </button>
      </p>
    </div>
  );
};

export default RegisterForm;
