import React from 'react';
import Logo from './Logo';
import { Phone, Mail, MapPin } from 'lucide-react';

const PublicFooter = ({ onNavigate }) => {
  return (
    <footer className="w-full bg-primary-navy text-gray-300 pt-12 pb-8 border-t border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-3 gap-10">

        {/* Brand Summary */}
        <div className="space-y-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-white rounded-full">
              <Logo className="w-8 h-8" />
            </div>
            <span className="text-xl font-bold text-white tracking-wider">Enlogada</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed max-w-sm">
            Quality diagnostic care with professional service, transparency, and compassionate expertise.
          </p>
        </div>

        {/* Our Services Quick Links */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Our Services</h2>
          <ul className="space-y-2 text-xs text-gray-400 list-none p-0">
            <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onNavigate && onNavigate('services')}>Ultrasound Services</li>
            <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onNavigate && onNavigate('services')}>Laboratory Testing</li>
            <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onNavigate && onNavigate('services')}>Digital X-Ray</li>
            <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onNavigate && onNavigate('services')}>2D Echo & ECG</li>
          </ul>
        </div>

        {/* Contact Info */}
        <div className="space-y-3">
          {/* h2 like its sibling above. These are peer sections of the footer, so they take the
              same level — one at h2 and one at h4 reads as a subsection of the other. */}
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Contact Info</h2>
          <div className="space-y-2.5 text-xs text-gray-400">
            <div className="flex items-center space-x-2.5">
              <Phone className="w-4 h-4 text-brand-600" />
              <span>0936 132 0650</span>
            </div>
            <div className="flex items-center space-x-2.5">
              <Mail className="w-4 h-4 text-brand-600" />
              <span>enlogadaclinic2011@gmail.com</span>
            </div>
            <div className="flex items-start space-x-2.5">
              <MapPin className="w-4 h-4 text-brand-600 flex-shrink-0 mt-0.5" />
              <span>Bugo, Cagayan de Oro, Philippines 9000</span>
            </div>
          </div>
        </div>

      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 mt-8 border-t border-gray-800 flex flex-col md:flex-row items-center justify-between text-xs text-gray-500">
        <p>© 2026 Enlogada Ultrasound & Diagnostic Clinic. All rights reserved.</p>
        <div className="flex items-center space-x-6 mt-4 md:mt-0">
          <button
            type="button"
            onClick={() => onNavigate && onNavigate('privacy')}
            className="hover:underline cursor-pointer border-0 bg-transparent p-0 text-gray-500 hover:text-white transition-colors"
          >
            Privacy Policy
          </button>
          <button
            type="button"
            onClick={() => onNavigate && onNavigate('terms')}
            className="hover:underline cursor-pointer border-0 bg-transparent p-0 text-gray-500 hover:text-white transition-colors"
          >
            Terms of Service
          </button>
        </div>
      </div>
    </footer>
  );
};

export default PublicFooter;
