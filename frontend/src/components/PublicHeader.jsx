import React, { useState } from 'react';
import Logo from './Logo';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, User, Menu, X } from 'lucide-react';

const NAV_LINKS = [
  { id: 'home', label: 'Home' },
  { id: 'services', label: 'Services' },
  { id: 'about', label: 'About Us' },
];

// Phase 1 (2026-08-12): this header was the measured cause of 131px of horizontal overflow at a
// 375px viewport (76px at 430px) on every public page — it had no breakpoint classes at all and
// forced brand + 3 nav links + 2 auth buttons onto one unwrapping row. Below `md` the links and
// auth actions now collapse into a dropdown panel. A dropdown, not a drawer: this is a 3-link
// nav, and Navbar.jsx (the Client shell) already solves the same problem this way — the two
// headers were diverging for no reason.
const PublicHeader = ({ currentTab = '', onNavigate }) => {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const go = (tab) => {
    setMenuOpen(false);
    onNavigate?.(tab);
  };

  const linkClass = (id) =>
    `transition-colors border-0 bg-transparent cursor-pointer ${
      currentTab === id ? 'text-[#769046] font-bold' : 'text-gray-700 hover:text-[#769046]'
    }`;

  return (
    <header className="w-full bg-white border-b border-gray-100 sticky top-0 z-50 shadow-xs">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between gap-3">
        {/* Brand */}
        <button
          type="button"
          onClick={() => go('home')}
          className="flex items-center space-x-2 sm:space-x-3 min-w-0 border-0 bg-transparent cursor-pointer p-0 text-left"
        >
          <Logo className="w-9 h-9 sm:w-10 sm:h-10 flex-shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-sm sm:text-base leading-tight tracking-wider text-[#769046]">ENLOGADA</span>
            <span className="hidden sm:block text-[10px] text-gray-500 font-semibold tracking-wide uppercase truncate">
              Ultrasound &amp; Diagnostic Clinic
            </span>
          </div>
        </button>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center space-x-6 lg:space-x-8">
          <nav className="flex items-center space-x-4 lg:space-x-6 text-sm font-semibold">
            {NAV_LINKS.map(link => (
              <button key={link.id} type="button" onClick={() => go(link.id)} className={linkClass(link.id)}>
                {link.label}
              </button>
            ))}
          </nav>

          {user ? (
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => go('dashboard')}
                className="flex items-center space-x-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-3.5 py-1.5 rounded-full text-xs font-semibold border-0 cursor-pointer transition-colors"
              >
                <span className="w-5 h-5 bg-[#769046] text-white rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="w-3 h-3" />
                </span>
                <span className="whitespace-nowrap">{user.firstName}</span>
              </button>
              <button
                type="button"
                onClick={logout}
                className="bg-primary-hover hover:bg-primary-active text-white px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 border-0 cursor-pointer shadow-xs transition-colors whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => go('login')}
                className="text-sm font-semibold text-gray-700 hover:text-[#769046] bg-transparent border-0 cursor-pointer whitespace-nowrap"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => go('register')}
                className="bg-primary-hover hover:bg-primary-active text-white px-4 py-2 rounded-lg text-xs font-semibold border-0 cursor-pointer shadow-xs transition-colors whitespace-nowrap"
              >
                Create Account
              </button>
            </div>
          )}
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          onClick={() => setMenuOpen(o => !o)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          className="md:hidden flex-shrink-0 p-2 rounded-lg border border-gray-200 text-slate-700 hover:bg-gray-50 bg-transparent cursor-pointer"
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile panel */}
      {menuOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 py-3 space-y-1 animate-fade-in">
          {NAV_LINKS.map(link => (
            <button
              key={link.id}
              type="button"
              onClick={() => go(link.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold border-0 bg-transparent cursor-pointer ${
                currentTab === link.id ? 'bg-[#769046]/10 text-[#769046]' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {link.label}
            </button>
          ))}

          <div className="pt-2 mt-2 border-t border-gray-100 space-y-2">
            {user ? (
              <>
                <button
                  type="button"
                  onClick={() => go('dashboard')}
                  className="w-full flex items-center justify-center space-x-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2.5 rounded-lg text-sm font-semibold border-0 cursor-pointer"
                >
                  <User className="w-4 h-4" />
                  <span>{user.firstName}'s Dashboard</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); logout(); }}
                  className="w-full flex items-center justify-center space-x-2 bg-primary-hover hover:bg-primary-active text-white px-4 py-2.5 rounded-lg text-sm font-semibold border-0 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Log Out</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => go('login')}
                  className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50 bg-transparent cursor-pointer"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => go('register')}
                  className="w-full bg-primary-hover hover:bg-primary-active text-white px-4 py-2.5 rounded-lg text-sm font-semibold border-0 cursor-pointer shadow-xs"
                >
                  Create Account
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default PublicHeader;
