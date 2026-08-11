import React from 'react';
import PublicHeader from '../components/PublicHeader';
import PublicFooter from '../components/PublicFooter';
import Logo from '../components/Logo';
import { Button } from '../components/ui/button';
import { ShieldCheck, Clock, Award, ChevronRight, Stethoscope, FlaskConical, Scan, HeartPulse, Activity } from 'lucide-react';

// Mirrors the 5 seeded test_categories rows exactly (database/schema.sql), same icon mapping
// ClientDashboard.jsx already uses per category — static/decorative, not live data, so the
// hero's right column doesn't need a fabricated stat to fill the space.
const SERVICE_PREVIEW = [
  { label: 'Ultrasound', icon: Stethoscope },
  { label: 'Laboratory', icon: FlaskConical },
  { label: 'Digital X-Ray', icon: Scan },
  { label: '2D Echo', icon: HeartPulse },
  { label: 'ECG', icon: Activity },
];

const Home = ({ onNavigate }) => {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PublicHeader currentTab="home" onNavigate={onNavigate} />

      {/* Hero Banner Section */}
      <section className="relative bg-primary-navy text-white min-h-[500px] flex items-center overflow-hidden">
        {/* UI/UX Phase 4: replaces a generic, unrelated stock photo with a brand-forward
            treatment — the clinic's own mark, large and faint, plus a subtle dot grid — so the
            hero reads as this clinic's, not a stock library's. */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: 'radial-gradient(circle, #ffffff 1.5px, transparent 1.5px)',
            backgroundSize: '28px 28px'
          }}
        />
        <div className="absolute -right-20 top-1/2 -translate-y-1/2 opacity-[0.08] pointer-events-none hidden md:block">
          <Logo className="w-[480px] h-[480px]" />
        </div>

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-primary-navy via-primary-navy/90 to-primary-navy/60" />

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
                className="bg-primary-hover hover:bg-primary-active text-white px-7 py-6 text-sm font-semibold rounded-xl shadow-lg border-0 cursor-pointer"
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

          {/* UI/UX Modernization Phase 8: the right column previously rendered nothing but the
              faint background logo — filled with a static services-preview card instead of a
              stock photo or a fabricated stat (e.g. "10,000+ patients"), consistent with Phase
              4's earlier decision to keep this hero brand-forward rather than reach for imagery. */}
          <div className="hidden md:flex justify-center">
            <div className="glass-card rounded-3xl p-7 w-full max-w-sm shadow-2xl">
              <span className="text-[11px] font-bold text-[#657c3a] uppercase tracking-widest">What We Offer</span>
              <h3 className="text-lg font-bold text-dark-slate mt-1 mb-5">Our Diagnostic Services</h3>
              <ul className="space-y-3 list-none p-0 m-0">
                {SERVICE_PREVIEW.map(({ label, icon: Icon }) => (
                  <li key={label} className="flex items-center space-x-3">
                    <span className="w-9 h-9 rounded-xl bg-[#769046]/10 text-[#769046] flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4.5 h-4.5" />
                    </span>
                    <span className="text-sm font-semibold text-slate-700">{label}</span>
                  </li>
                ))}
              </ul>
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
        <div className="bg-primary-navy rounded-3xl p-10 text-white flex flex-col md:flex-row items-center justify-between shadow-xl">
          <div className="space-y-2 mb-6 md:mb-0">
            <h2 className="text-2xl font-bold tracking-tight">Need a Diagnostic Appointment?</h2>
            <p className="text-sm text-gray-300">Sign in to your account or register to schedule an appointment today.</p>
          </div>
          <Button
            onClick={() => onNavigate && onNavigate('login')}
            className="bg-primary-hover hover:bg-primary-active text-white px-8 py-6 text-sm font-bold rounded-xl flex items-center space-x-2 border-0 cursor-pointer"
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
