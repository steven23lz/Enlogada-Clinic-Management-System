import React from 'react';
import Logo from './Logo';
import { Phone, Mail, MapPin } from 'lucide-react';

const PublicFooter = ({ onNavigate }) => {
  return (
    <footer className="w-full bg-[#1e293b] text-gray-300 pt-12 pb-8 border-t border-gray-800">
      <div className="max-w-7xl mx-auto px-8 grid grid-cols-1 md:grid-cols-3 gap-10">
        
        {/* Brand Summary */}
        <div className="space-y-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-white rounded-xl">
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
          <h4 className="text-sm font-bold text-white uppercase tracking-wider">Our Services</h4>
          <ul className="space-y-2 text-xs text-gray-400 list-none p-0">
            <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onNavigate && onNavigate('services')}>Ultrasound Services</li>
            <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onNavigate && onNavigate('services')}>Laboratory Testing</li>
            <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onNavigate && onNavigate('services')}>Digital X-Ray</li>
            <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onNavigate && onNavigate('services')}>2D Echo & ECG</li>
          </ul>
        </div>

        {/* Contact Info */}
        <div className="space-y-3">
          <h4 className="text-sm font-bold text-white uppercase tracking-wider">Contact Info</h4>
          <div className="space-y-2.5 text-xs text-gray-400">
            <div className="flex items-center space-x-2.5">
              <Phone className="w-4 h-4 text-[#769046]" />
              <span>0936 132 0650</span>
            </div>
            <div className="flex items-center space-x-2.5">
              <Mail className="w-4 h-4 text-[#769046]" />
              <span>enlogadaclinic2011@gmail.com</span>
            </div>
            <div className="flex items-start space-x-2.5">
              <MapPin className="w-4 h-4 text-[#769046] flex-shrink-0 mt-0.5" />
              <span>Bugo, Cagayan de Oro, Philippines 9000</span>
            </div>
          </div>
        </div>

      </div>

      <div className="max-w-7xl mx-auto px-8 pt-8 mt-8 border-t border-gray-800 flex flex-col md:flex-row items-center justify-between text-xs text-gray-500">
        <p>© 2026 Enlogada Ultrasound & Diagnostic Clinic. All rights reserved.</p>
        <div className="flex items-center space-x-6 mt-4 md:mt-0">
          <span className="hover:underline cursor-pointer">Privacy Policy</span>
          <span className="hover:underline cursor-pointer">Terms of Service</span>
        </div>
      </div>
    </footer>
  );
};

export default PublicFooter;
