import React, { useState } from 'react';
import PublicHeader from '../../components/PublicHeader';
import Logo from '../../components/Logo';
import LoginForm from '../../components/auth/LoginForm';
import RegisterForm from '../../components/auth/RegisterForm';
import { useClinic } from '../../lib/clinic';
import { ShieldCheck, Clock, HeartHandshake } from 'lucide-react';

// UI/UX Modernization Phase 6: merges Login.jsx and Register.jsx into one page that owns its own
// login/register sub-state, so toggling between them no longer fully unmounts/remounts the page.
//
// ── Why the page changed shape [1.23.0] ───────────────────────────────────────────────────────
// It was a max-width container holding a white form card next to a second card, sitting between
// the public header and the public footer. Four framed rectangles on one screen, none of which
// was obviously the thing to do next, and a footer full of links directly beneath the password
// field — on the one page where the entire job is "sign in".
//
// Now: full height, two columns, nothing below the fold. The form has no card of its own because
// its column IS the card; a box inside a box is what made the old version feel cramped. The right
// column is dark and carries the reassurance a first-time patient actually needs before typing
// their details into a medical system — who runs this, that results are handled properly, that
// their HMO is accepted. It is hidden below `lg`, where the form should have the screen to itself.
//
// The public footer is gone from this page specifically. Its links belong on a marketing page,
// not under a login form.
const TRUST_POINTS = [
  {
    icon: ShieldCheck,
    title: 'Licensed diagnostics',
    body: 'Certified medical technologists and radiologists handle every test.',
  },
  {
    icon: Clock,
    title: 'Results you can reach',
    body: 'Reports are released to your account and emailed the moment they are signed off.',
  },
  {
    icon: HeartHandshake,
    title: 'HMO and senior/PWD',
    body: 'Accredited providers, and statutory discounts applied at the counter.',
  },
];

const AuthPage = ({ initialMode = 'login', onNavigate }) => {
  const [mode, setMode] = useState(initialMode);
  // Runtime identity, so the address here and on the receipt cannot disagree. See lib/clinic.js.
  const CLINIC = useClinic();

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <PublicHeader currentTab={mode} onNavigate={onNavigate} />

      <main className="flex flex-1 items-stretch">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
          {/* Form. No Card wrapper — the column is the surface. */}
          <div className="mx-auto w-full max-w-md">
            <div key={mode} className="animate-fade-in">
              {mode === 'login' ? (
                <LoginForm onSwitchToRegister={() => setMode('register')} onNavigate={onNavigate} />
              ) : (
                <RegisterForm onSwitchToLogin={() => setMode('login')} />
              )}
            </div>
          </div>

          {/* Brand and reassurance. Stays put across the crossfade — only the form changes. */}
          <aside className="rail-gradient rail-grid relative hidden overflow-hidden rounded-2xl border border-[#2b3a4d] p-10 text-white lg:block">
            <div className="relative">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.07] ring-1 ring-inset ring-white/10">
                  <Logo className="h-8 w-8" />
                </span>
                <div className="leading-tight">
                  <p className="m-0 text-[15px] font-bold tracking-tight text-white">{CLINIC.shortName}</p>
                  <p className="m-0 text-micro font-semibold uppercase tracking-[0.14em] text-brand-300">
                    Ultrasound &amp; Diagnostic Clinic
                  </p>
                </div>
              </div>

              <h2 className="m-0 mt-8 max-w-sm text-2xl font-bold leading-snug tracking-tight text-white">
                Book a test, follow your visit, and collect your results in one place.
              </h2>

              <ul className="m-0 mt-8 list-none space-y-5 p-0">
                {TRUST_POINTS.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="flex gap-3">
                    <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-500/20 text-brand-300">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-white">{title}</span>
                      <span className="block text-fine leading-relaxed text-slate-400">{body}</span>
                    </span>
                  </li>
                ))}
              </ul>

              <p className="m-0 mt-10 border-t border-white/10 pt-5 text-fine leading-relaxed text-slate-400">
                {CLINIC.address}
                <span className="mx-1.5 text-slate-600">·</span>
                {CLINIC.phone}
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};

export default AuthPage;
