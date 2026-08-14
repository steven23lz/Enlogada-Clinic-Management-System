import React, { useState, useEffect } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { GOOGLE_CLIENT_ID, isGoogleAuthConfigured } from './config/googleAuth';
import { CONSOLE, consoleForNav, defaultNavForRoles } from './config/navigation';
import Home from './pages/Home';
import AboutUs from './pages/AboutUs';
import ServicesPage from './pages/ServicesPage';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import AuthPage from './pages/AuthPage';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ClientDashboard from './pages/ClientDashboard';
import ClientProfile from './pages/ClientProfile';
import ReceptionistDashboard from './pages/ReceptionistDashboard';
import CashierDashboard from './pages/CashierDashboard';
import DiagnosticDashboard from './pages/DiagnosticDashboard';
import AdminDashboard from './pages/AdminDashboard';
import ServicesCatalog from './pages/ServicesCatalog';
import StaffAccountSettings from './pages/StaffAccountSettings';

// Read a one-time deep-link param from the URL (e.g. an emailed password-reset link) without
// introducing a router — this app deliberately has none (see PROJECT_STRUCTURE.md). Read once
// on initial mount only; nothing else in the app reads or writes the URL.
const getInitialResetToken = () => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('reset_token');
};

const MainApp = () => {
  const { user, loading, rolesChanged, logout } = useAuth();
  const [resetToken] = useState(getInitialResetToken);
  const [currentTab, setCurrentTab] = useState(() => (getInitialResetToken() ? 'reset-password' : 'home')); // 'home', 'services', 'about', 'login', 'register', 'forgot-password', 'reset-password', 'dashboard', 'account'
  const [activeNav, setActiveNav] = useState(null); // Active nav in staff/admin sidebar

  // Land each user on a destination they actually hold. This used to default to 'dashboard' —
  // an Admin/SuperAdmin-only destination — so every other role signed in pointing at an id it
  // did not own, and the sidebar highlighted nothing on arrival. Also re-homes anyone whose
  // current destination stops being reachable (e.g. a role was revoked mid-session).
  const roleKey = (user?.roles || []).join(',');
  useEffect(() => {
    if (!user || (user.roles || []).includes('Client')) return;
    const roles = user.roles || [];
    if (activeNav === 'account') return;
    if (!activeNav || !consoleForNav(activeNav, roles)) {
      setActiveNav(defaultNavForRoles(roles));
    }
    // activeNav is deliberately not a dependency: this corrects the destination on sign-in and
    // on a role change, not on every navigation the user makes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, roleKey]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center space-y-3">
        <div className="w-10 h-10 border-4 border-[#769046] border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm font-semibold text-gray-500">Loading Enlogada Clinic...</span>
      </div>
    );
  }

  const handleNavigate = (tab) => {
    setCurrentTab(tab);
  };

  // If user is NOT logged in
  if (!user) {
    if (currentTab === 'services') {
      return <ServicesPage onNavigate={handleNavigate} />;
    }
    if (currentTab === 'privacy') {
      return <PrivacyPolicy onNavigate={handleNavigate} />;
    }
    if (currentTab === 'terms') {
      return <TermsOfService onNavigate={handleNavigate} />;
    }
    if (currentTab === 'about') {
      return <AboutUs onNavigate={handleNavigate} />;
    }
    if (currentTab === 'home') {
      return <Home onNavigate={handleNavigate} />;
    }
    if (currentTab === 'register') {
      return <AuthPage key={currentTab} initialMode="register" onNavigate={handleNavigate} />;
    }
    if (currentTab === 'forgot-password') {
      return <ForgotPassword onNavigate={handleNavigate} />;
    }
    if (currentTab === 'reset-password') {
      return <ResetPassword token={resetToken} onNavigate={handleNavigate} />;
    }
    // Default fallback to login
    return <AuthPage key={currentTab} initialMode="login" onNavigate={handleNavigate} />;
  }

  // If user IS logged in
  const roles = user.roles || [];

  // An administrator changed this account's roles while it was signed in. The session keeps
  // running on the roles the token carries, because those are the only ones the API will honour
  // — but saying nothing would leave someone waiting for access that was granted minutes ago, or
  // still using access that was revoked. Both are worth one line on screen.
  const roleChangeNotice = rolesChanged ? (
    <div
      role="status"
      className="flex items-center justify-between gap-3 bg-amber-50 border-b border-amber-200 px-4 py-2 text-fine text-amber-900"
    >
      <span>
        <strong className="font-bold">Your access has been updated.</strong> Sign out and back in
        to apply the change — this session is still running on your previous permissions.
      </span>
      <button
        onClick={logout}
        className="flex-shrink-0 font-bold underline underline-offset-2 hover:text-amber-950 bg-transparent border-0 cursor-pointer text-fine"
      >
        Sign out
      </button>
    </div>
  ) : null;

  // Wraps whatever console the routing below resolves to, so the notice appears once for every
  // role rather than being pasted into each dashboard.
  const withNotice = (screen) =>
    roleChangeNotice ? (
      <>
        {roleChangeNotice}
        {screen}
      </>
    ) : (
      screen
    );

  // Client has no sidebar console; it keeps its own public-style shell and tab model.
  if (roles.includes('Client')) {
    if (currentTab === 'services') return <ServicesPage onNavigate={handleNavigate} />;
    if (currentTab === 'about') return <AboutUs onNavigate={handleNavigate} />;
    if (currentTab === 'account') return <ClientProfile onNavigate={handleNavigate} />;
    return withNotice(<ClientDashboard onNavigate={handleNavigate} />);
  }

  // Every SidebarLayout-based role can reach a shared, self-service account page via the
  // sidebar's user-info block — see StaffAccountSettings.jsx. Checked before the nav routing
  // below since it applies uniformly and is not a role-gated destination.
  if (activeNav === 'account') {
    return <StaffAccountSettings onSelectNav={setActiveNav} />;
  }

  if (roles.includes('SuperAdmin') || roles.includes('Admin')) {
    if (currentTab === 'services') return <ServicesPage onNavigate={handleNavigate} />;
    if (currentTab === 'about') return <AboutUs onNavigate={handleNavigate} />;
  }

  // Route by DESTINATION, not by a fixed role priority. A user holding several operational
  // roles reaches every console their roles grant; previously the first matching role won and
  // the rest of their sidebar was decorative (see config/navigation.js for the full history).
  //
  // Resolve to a destination this user genuinely holds before rendering. The effect above
  // settles `activeNav` too, but only after the first paint — consoles derive their category
  // and mode straight from this prop, so they must never receive the unset value. An
  // unreachable destination falls back to the user's own default rather than rendering someone
  // else's console, so a stale activeNav cannot leak a screen either.
  const resolvedNav = consoleForNav(activeNav, roles) ? activeNav : defaultNavForRoles(roles);
  const targetConsole = consoleForNav(resolvedNav, roles);

  switch (targetConsole) {
    case CONSOLE.RECEPTION:
      return withNotice(<ReceptionistDashboard activeNav={resolvedNav} onSelectNav={setActiveNav} />);
    case CONSOLE.CASHIER:
      return withNotice(<CashierDashboard activeNav={resolvedNav} onSelectNav={setActiveNav} />);
    case CONSOLE.DIAGNOSTIC:
      return withNotice(<DiagnosticDashboard activeNav={resolvedNav} onSelectNav={setActiveNav} />);
    case CONSOLE.SERVICES_CATALOG:
      return withNotice(<ServicesCatalog activeNav={resolvedNav} onSelectNav={setActiveNav} />);
    case CONSOLE.ADMIN:
      return withNotice(<AdminDashboard activeNav={resolvedNav} onSelectNav={setActiveNav} />);
    default:
      break;
  }

  // Fallback for unauthorized roles
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="text-center space-y-2 bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-red-500">Unauthorized Profile Access</h2>
        <p className="text-sm text-gray-500">Your account does not have any clinical roles assigned.</p>
      </div>
    </div>
  );
};

function App() {
  const app = (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );

  // Mount the provider only when a real client ID exists. It loads Google's Identity Services
  // script on mount, and with no usable client ID that script can only fail — so when Google
  // Sign-In is unconfigured we skip it entirely and LoginForm.jsx renders its explanatory notice
  // in place of the button (rendering <GoogleLogin> outside this provider would throw).
  if (!isGoogleAuthConfigured) {
    return app;
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      {app}
    </GoogleOAuthProvider>
  );
}

export default App;
