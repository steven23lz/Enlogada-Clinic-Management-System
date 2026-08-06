import React from 'react';
import PublicHeader from '../components/PublicHeader';
import PublicFooter from '../components/PublicFooter';
import { Button } from '../components/ui/button';
import { ShieldCheck, Clock, Award, ChevronRight } from 'lucide-react';

const Home = ({ onNavigate }) => {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PublicHeader currentTab="home" onNavigate={onNavigate} />

      {/* Hero Banner Section matching Image 3 */}
      <section className="relative bg-slate-900 text-white min-h-[500px] flex items-center overflow-hidden">
        {/* Background Image Overlay */}
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-30 mix-blend-overlay"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1600&q=80')`
          }}
        />

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900 via-slate-900/90 to-transparent" />

        <div className="relative max-w-7xl mx-auto px-8 py-20 z-10 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="space-y-6">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
              ENLOGADA - Your Trusted Diagnostic Partner
            </h1>
            <p className="text-gray-300 text-base leading-relaxed max-w-lg">
              Professional ultrasound and diagnostic services with all the care and attention you deserve. We're experienced healthcare professionals dedicated to your well-being.
            </p>

            <div className="flex items-center space-x-4 pt-2">
              <Button
                onClick={() => onNavigate && onNavigate('login')}
                className="bg-[#769046] hover:bg-[#687e3d] text-white px-7 py-6 text-sm font-semibold rounded-xl shadow-lg border-0 cursor-pointer"
              >
                Book Now
              </Button>
              <Button
                onClick={() => onNavigate && onNavigate('services')}
                variant="outline"
                className="bg-white hover:bg-gray-100 text-slate-800 border-0 px-7 py-6 text-sm font-semibold rounded-xl cursor-pointer"
              >
                View Services
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Key Highlights Banner */}
      <section className="bg-white py-12 border-b border-gray-100 shadow-xs">
        <div className="max-w-7xl mx-auto px-8 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="flex items-start space-x-4 p-4 rounded-xl bg-gray-50/50 border border-gray-100">
            <div className="p-3 bg-[#769046]/10 text-[#769046] rounded-xl">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-gray-900 text-base m-0">Licensed Diagnostics</h3>
              <p className="text-xs text-gray-500 m-0">Certified laboratory tech & radiologists handling your medical tests.</p>
            </div>
          </div>

          <div className="flex items-start space-x-4 p-4 rounded-xl bg-gray-50/50 border border-gray-100">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <Clock className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-gray-900 text-base m-0">Fast & Accurate Results</h3>
              <p className="text-xs text-gray-500 m-0">Digital result releasing notified directly to your email inbox.</p>
            </div>
          </div>

          <div className="flex items-start space-x-4 p-4 rounded-xl bg-gray-50/50 border border-gray-100">
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <Award className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-gray-900 text-base m-0">HMO & Private Support</h3>
              <p className="text-xs text-gray-500 m-0">HMO verification integrated with manual authorization code tracking.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Call to Action Bar */}
      <section className="max-w-7xl mx-auto px-8 py-16 w-full">
        <div className="bg-[#1e293b] rounded-3xl p-10 text-white flex flex-col md:flex-row items-center justify-between shadow-xl">
          <div className="space-y-2 mb-6 md:mb-0">
            <h2 className="text-2xl font-bold tracking-tight">Need a Diagnostic Appointment?</h2>
            <p className="text-sm text-gray-300">Sign in to your account or register to schedule an appointment today.</p>
          </div>
          <Button
            onClick={() => onNavigate && onNavigate('login')}
            className="bg-[#769046] hover:bg-[#687e3d] text-white px-8 py-6 text-sm font-bold rounded-xl flex items-center space-x-2 border-0 cursor-pointer"
          >
            <span>Access Portal</span>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </section>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default Home;
