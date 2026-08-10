import React from 'react';
import Logo from './Logo';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, User } from 'lucide-react';

const PublicHeader = ({ currentTab = '', onNavigate }) => {
  const { user, logout } = useAuth();

  return (
    <header className="w-full bg-white border-b border-gray-100 px-8 py-4 flex items-center justify-between sticky top-0 z-50 shadow-xs">
      {/* Brand Identity */}
      <div 
        className="flex items-center space-x-3 cursor-pointer"
        onClick={() => onNavigate && onNavigate('home')}
      >
        <Logo className="w-10 h-10" />
        <div className="flex flex-col">
          <span className="font-bold text-base leading-tight tracking-wider text-[#769046]">ENLOGADA</span>
          <span className="text-[10px] text-gray-500 font-semibold tracking-wide uppercase">Ultrasound & Diagnostic Clinic</span>
        </div>
      </div>

      {/* Navigation Links */}
      <div className="flex items-center space-x-8">
        <nav className="flex items-center space-x-6 text-sm font-semibold">
          <button
            onClick={() => onNavigate && onNavigate('home')}
            className={`transition-colors border-0 bg-transparent cursor-pointer ${
              currentTab === 'home' ? 'text-[#769046] font-bold' : 'text-gray-700 hover:text-[#769046]'
            }`}
          >
            Home
          </button>
          <button
            onClick={() => onNavigate && onNavigate('services')}
            className={`transition-colors border-0 bg-transparent cursor-pointer ${
              currentTab === 'services' ? 'text-[#769046] font-bold' : 'text-gray-700 hover:text-[#769046]'
            }`}
          >
            Services
          </button>
          <button
            onClick={() => onNavigate && onNavigate('about')}
            className={`transition-colors border-0 bg-transparent cursor-pointer ${
              currentTab === 'about' ? 'text-[#769046] font-bold' : 'text-gray-700 hover:text-[#769046]'
            }`}
          >
            About Us
          </button>
        </nav>

        {user ? (
          <div className="flex items-center space-x-3">
            <button
              onClick={() => onNavigate && onNavigate('dashboard')}
              className="flex items-center space-x-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-3.5 py-1.5 rounded-full text-xs font-semibold border-0 cursor-pointer transition-colors"
            >
              <div className="w-5 h-5 bg-[#769046] text-white rounded-full flex items-center justify-center">
                <User className="w-3 h-3" />
              </div>
              <span>{user.firstName}</span>
            </button>
            <button
              onClick={logout}
              className="bg-[#769046] hover:bg-primary-hover text-white px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 border-0 cursor-pointer shadow-xs transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log Out</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center space-x-3">
            <button
              onClick={() => onNavigate && onNavigate('login')}
              className="text-sm font-semibold text-gray-700 hover:text-[#769046] bg-transparent border-0 cursor-pointer"
            >
              Sign In
            </button>
            <button
              onClick={() => onNavigate && onNavigate('register')}
              className="bg-[#769046] hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-xs font-semibold border-0 cursor-pointer shadow-xs transition-colors"
            >
              Create Account
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default PublicHeader;
