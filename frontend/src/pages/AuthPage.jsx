import React, { useState } from 'react';
import PublicHeader from '../components/PublicHeader';
import PublicFooter from '../components/PublicFooter';
import Logo from '../components/Logo';
import LoginForm from '../components/auth/LoginForm';
import RegisterForm from '../components/auth/RegisterForm';

// UI/UX Modernization Phase 6: merges Login.jsx and Register.jsx into one page that owns its
// own login/register sub-state, so toggling between them no longer fully unmounts/remounts the
// page (App.jsx previously swapped currentTab between 'login' and 'register', tearing down and
// rebuilding everything including the shared header/footer/graphic panel). Both forms are now
// unified to the same graphic-panel-on-the-right layout (Register's used to be mirrored, on the
// left) so the two only differ in the card that crossfades between them — reuses the existing
// `.animate-fade-in` keyframe (index.css) via `key={mode}` rather than adding an animation
// dependency; no router is introduced, App.jsx still owns one entry per external nav trigger.
const AuthPage = ({ initialMode = 'login', onNavigate }) => {
  const [mode, setMode] = useState(initialMode);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PublicHeader currentTab={mode} onNavigate={onNavigate} />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex items-center justify-center w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center w-full max-w-5xl">

          {/* Left Column: crossfading form card */}
          <div className="space-y-6">
            <div key={mode} className="animate-fade-in">
              {mode === 'login' ? (
                <LoginForm onSwitchToRegister={() => setMode('register')} onNavigate={onNavigate} />
              ) : (
                <RegisterForm onSwitchToLogin={() => setMode('login')} />
              )}
            </div>
          </div>

          {/* Right Column: shared branding graphic — stays put across the crossfade, only the
              form card to its left changes.

              Dark rather than another white card. The form beside it is already a white card on a
              near-white page; a second one made the two read as a pair of equal panels, so the
              eye had no reason to start at the one you have to fill in. */}
          <div className="hidden items-center justify-center md:flex">
            <div className="rail-gradient rail-grid relative flex w-full max-w-sm flex-col items-center justify-center gap-5 overflow-hidden rounded-2xl border border-[#2b3a4d] p-10 text-center">
              <div className="relative flex h-44 w-44 items-center justify-center rounded-full bg-white/[0.06] p-3 ring-1 ring-inset ring-white/10">
                <Logo className="h-28 w-28" />
              </div>
              <div className="relative space-y-1">
                <h2 className="m-0 text-xl font-extrabold tracking-tight text-white">Enlogada</h2>
                <p className="m-0 text-micro font-semibold uppercase tracking-[0.14em] text-brand-300">Ultrasound &amp; Diagnostic Clinic</p>
                <p className="m-0 pt-1 text-fine text-slate-400">Quality diagnostic care you can trust</p>
              </div>
            </div>
          </div>

        </div>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default AuthPage;
