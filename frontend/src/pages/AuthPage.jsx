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
              form card to its left changes. */}
          <div className="hidden md:flex justify-center items-center">
            <div className="bg-white p-10 rounded-3xl shadow-xl border border-gray-100 flex flex-col items-center justify-center space-y-5 w-full max-w-sm text-center">
              <div className="w-48 h-48 rounded-full border-4 border-[#769046]/40 flex items-center justify-center p-3 bg-gray-50/30">
                <Logo className="w-32 h-32" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-extrabold text-[#769046]">Enlogada</h2>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-600">Ultrasound & Diagnostic Clinic</p>
                <p className="text-xs text-gray-400 font-medium pt-1">Quality Diagnostic Care You Can Trust</p>
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
