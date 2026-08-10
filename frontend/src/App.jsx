import React, { useState } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Home from './pages/Home';
import ServicesPage from './pages/ServicesPage';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ClientDashboard from './pages/ClientDashboard';
import ClientProfile from './pages/ClientProfile';
import ReceptionistDashboard from './pages/ReceptionistDashboard';
import CashierDashboard from './pages/CashierDashboard';
import DiagnosticDashboard from './pages/DiagnosticDashboard';
import AdminDashboard from './pages/AdminDashboard';
import ServicesCatalog from './pages/ServicesCatalog';

// Read a one-time deep-link param from the URL (e.g. an emailed password-reset link) without
// introducing a router — this app deliberately has none (see PROJECT_STRUCTURE.md). Read once
// on initial mount only; nothing else in the app reads or writes the URL.
const getInitialResetToken = () => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('reset_token');
};

const MainApp = () => {
  const { user, loading } = useAuth();
  const [resetToken] = useState(getInitialResetToken);
  const [currentTab, setCurrentTab] = useState(() => (getInitialResetToken() ? 'reset-password' : 'home')); // 'home', 'services', 'about', 'login', 'register', 'forgot-password', 'reset-password', 'dashboard', 'account'
  const [activeNav, setActiveNav] = useState('dashboard'); // Active nav in staff/admin sidebar

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
    if (currentTab === 'about' || currentTab === 'home') {
      return <Home onNavigate={handleNavigate} />;
    }
    if (currentTab === 'register') {
      return <Register onToggleView={() => setCurrentTab('login')} onNavigate={handleNavigate} />;
    }
    if (currentTab === 'forgot-password') {
      return <ForgotPassword onNavigate={handleNavigate} />;
    }
    if (currentTab === 'reset-password') {
      return <ResetPassword token={resetToken} onNavigate={handleNavigate} />;
    }
    // Default fallback to login
    return <Login onToggleView={() => setCurrentTab('register')} onNavigate={handleNavigate} />;
  }

  // If user IS logged in
  const roles = user.roles || [];

  // SuperAdmin and Admin
  if (roles.includes('SuperAdmin') || roles.includes('Admin')) {
    if (currentTab === 'services') {
      return <ServicesPage onNavigate={handleNavigate} />;
    }
    if (currentTab === 'about') {
      return <Home onNavigate={handleNavigate} />;
    }

    if (activeNav === 'services-cat') return <ServicesCatalog activeNav={activeNav} onSelectNav={setActiveNav} />;
    if (activeNav === 'reception-ops') return <ReceptionistDashboard activeNav={activeNav} onSelectNav={setActiveNav} />;
    if (activeNav === 'cashier-ops') return <CashierDashboard activeNav={activeNav} onSelectNav={setActiveNav} />;
    if (activeNav === 'lab-ops' || activeNav === 'ultrasound-ops' || activeNav === 'xray-ops') {
      return <DiagnosticDashboard activeNav={activeNav} onSelectNav={setActiveNav} />;
    }

    return <AdminDashboard activeNav={activeNav} onSelectNav={setActiveNav} />;
  }

  // Standard Role-based Routing
  if (roles.includes('Client')) {
    if (currentTab === 'services') return <ServicesPage onNavigate={handleNavigate} />;
    if (currentTab === 'about') return <Home onNavigate={handleNavigate} />;
    if (currentTab === 'account') return <ClientProfile onNavigate={handleNavigate} />;
    return <ClientDashboard onNavigate={handleNavigate} />;
  }

  if (roles.includes('Receptionist')) {
    return <ReceptionistDashboard activeNav={activeNav} onSelectNav={setActiveNav} />;
  }

  if (roles.includes('Cashier')) {
    return <CashierDashboard activeNav={activeNav} onSelectNav={setActiveNav} />;
  }

  if (
    roles.includes('Laboratory Staff') ||
    roles.includes('Xray Staff') ||
    roles.includes('Ultrasound Staff')
  ) {
    return <DiagnosticDashboard activeNav={activeNav} onSelectNav={setActiveNav} />;
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

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'dummy_client_id';

function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}

export default App;
