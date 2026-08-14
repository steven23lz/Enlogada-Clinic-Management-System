import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import Logo from './Logo';
import { Button } from './ui/button';
import { LogOut, User } from 'lucide-react';

const Navbar = ({ onNavigate, activeTab = 'dashboard' }) => {
  const { user, logout } = useAuth();

  return (
    <header className="w-full bg-white border-b border-gray-100 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between sticky top-0 z-50 gap-2">
      {/* Clinic Identity (Logo + Name) */}
      <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-shrink-0">
        <Logo className="w-9 h-9 sm:w-11 sm:h-11 flex-shrink-0" />
        <div className="flex flex-col min-w-0">
          <span className="font-bold text-base sm:text-lg leading-tight tracking-wider text-dark-slate truncate">ENLOGADA</span>
          <span className="hidden sm:block text-meta text-gray-500 font-medium tracking-wide uppercase truncate">Ultrasound & Diagnostic Clinic</span>
        </div>
      </div>

      {/* Navigation and User Actions */}
      <div className="flex items-center space-x-2 sm:space-x-8 flex-shrink-0">
        <nav className="flex items-center space-x-2 sm:space-x-6">
          <button
            type="button"
            onClick={() => onNavigate?.('dashboard')}
            className={`text-xs sm:text-sm font-semibold pb-1 bg-transparent border-0 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
              activeTab === 'dashboard' ? 'text-[#769046] border-[#769046]' : 'text-gray-400 border-transparent hover:text-gray-600'
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => onNavigate?.('account')}
            className={`text-xs sm:text-sm font-semibold pb-1 bg-transparent border-0 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
              activeTab === 'account' ? 'text-[#769046] border-[#769046]' : 'text-gray-400 border-transparent hover:text-gray-600'
            }`}
          >
            <span className="hidden sm:inline">My Account</span>
            <span className="sm:hidden">Account</span>
          </button>
        </nav>

        {user && (
          <div className="flex items-center space-x-2 sm:space-x-4">
            {/* User Badge */}
            <button
              type="button"
              onClick={() => onNavigate?.('account')}
              aria-label="Manage account settings"
              className="flex items-center space-x-2 bg-gray-50 border border-gray-100 rounded-full px-2 sm:px-4 py-2 text-sm text-gray-700 font-medium shadow-sm cursor-pointer hover:border-[#769046]/40 transition-colors"
            >
              <div className="w-6 h-6 bg-primary-navy/15 rounded-full flex items-center justify-center text-primary-navy flex-shrink-0">
                <User className="w-3.5 h-3.5" />
              </div>
              <span className="hidden md:inline whitespace-nowrap">{user.firstName} {user.lastName}</span>
            </button>

            {/* Log Off Button */}
            <Button
              variant="ghost"
              onClick={logout}
              aria-label="Log Off"
              className="text-red-500 hover:text-red-600 hover:bg-red-50/50 flex items-center space-x-2 font-medium text-sm transition-colors rounded-full px-2 sm:px-4"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Log Off</span>
            </Button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Navbar;
