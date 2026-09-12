import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PasswordInput } from '../ui/password-input';
import AuthField from './AuthField';
import PasswordMeter from './PasswordMeter';
import { MIN_PASSWORD_LENGTH } from '../../lib/passwordStrength';
import { cn } from '../../lib/utils';
import { AlertCircle, ArrowRight, Lock, Mail, Phone, User } from 'lucide-react';

// The back of the sign-in card: the form only. AuthPage.jsx owns the card, the turn between its
// two sides and the page around it. `onSwitchToLogin` turns the card back over — from the link at
// the bottom, and by itself two seconds after an account is created.
const RegisterForm = ({ onSwitchToLogin }) => {
  const { register } = useAuth();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    contactNumber: ''
  });
  const [error, setError] = useState('');
  const [created, setCreated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Counts rejections rather than holding a flag, so React sees a NEW element each time and
  // replays the shake. A boolean would sit there already-true and the second wrong attempt would
  // look like nothing happened.
  const [rejections, setRejections] = useState(0);

  // The hand-over to Sign In after success, cleared if the form goes first. The timer used to
  // outlive the form, so someone who left for another page within two seconds of registering was
  // pulled back to Sign In.
  const handOver = useRef(null);
  useEffect(() => () => clearTimeout(handOver.current), []);

  const update = (field) => (e) => setFormData((d) => ({ ...d, [field]: e.target.value }));

  // Said while they type, not after they submit. The mismatch is the one error on this form the
  // browser can detect without asking the server, and finding out at submit time means retyping
  // a password they already typed twice.
  const passwordsMismatch =
    formData.confirmPassword.length > 0 && formData.password !== formData.confirmPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const { firstName, lastName, email, password, confirmPassword, contactNumber } = formData;
    const reject = (message) => {
      setError(message);
      setRejections((n) => n + 1);
    };

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
      await register({
        firstName,
        lastName,
        email,
        password,
        contactNumber
      });
      setCreated(true);
      handOver.current = setTimeout(onSwitchToLogin, 2000);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  // The whole side becomes the confirmation. A green line above a form that is still sitting there,
  // filled in, reads as "something happened" rather than "you are done here".
  if (created) {
    return (
      <div role="status" className="py-6 text-center">
        <svg className="auth-check mx-auto h-20 w-20 text-brand-600" viewBox="0 0 52 52" aria-hidden="true">
          <circle cx="26" cy="26" r="24" />
          <path d="M15 27l7 7 15-15" />
        </svg>
        <h2 id="register-title" className="m-0 mt-4 text-2xl font-bold tracking-tight text-slate-900">
          Account created
        </h2>
        <p className="m-0 mt-1 text-note leading-relaxed text-slate-500">
          You can now sign in. Taking you there…
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="auth-rise text-center" style={{ '--i': 1 }}>
        <h1 id="register-title" className="m-0 text-2xl font-bold tracking-tight text-slate-900">
          Create your account
        </h1>
        <p className="m-0 mt-1 text-note leading-relaxed text-slate-500">
          One minute, and you can book tests and receive results online.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {error && (
          <div key={rejections} role="alert" className="alert alert-error animate-shake">
            <AlertCircle />
            <span>{error}</span>
          </div>
        )}

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
