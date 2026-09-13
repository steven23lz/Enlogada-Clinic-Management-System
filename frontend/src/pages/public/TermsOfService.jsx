import React from 'react';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import PageHero from '../../components/public/PageHero';
import LegalDocument from '../../components/public/LegalDocument';
import { Calendar, CreditCard, FileCheck, AlertCircle } from 'lucide-react';

// The terms' words are unchanged by the [1.72.0] restyle; only the page around them is new.
const SECTIONS = [
  {
    id: 'appointments',
    icon: Calendar,
    title: 'Appointments & Cancellations',
    body: `Appointments booked through this system reserve a specific date, time, and diagnostic service.
      Please cancel through your account or contact the clinic as early as possible if you cannot make it,
      so the slot can be offered to another patient. Repeated no-shows may affect your ability to book
      online.`,
  },
  {
    id: 'billing',
    icon: CreditCard,
    title: 'Billing & Payment',
    body: `Prices shown for each test reflect the rate at the time of your visit and may change for future
      visits. HMO coverage is applied per test based on an approved pre-authorization on file; any portion
      not covered is payable at the clinic. Payment is due at the time of service unless other
      arrangements have been made with billing staff.`,
  },
  {
    id: 'results',
    icon: FileCheck,
    title: 'Diagnostic Results',
    body: `Results are prepared by qualified clinic staff and released once findings are finalized. Results
      are provided for your own reference and for use by your attending physician — they are not a
      substitute for professional medical advice, diagnosis, or treatment, and should be discussed with
      your doctor.`,
  },
  {
    id: 'account',
    icon: AlertCircle,
    title: 'Account Responsibility',
    body: `You are responsible for keeping your login credentials confidential and for the accuracy of the
      information you provide when registering a patient profile or booking a visit. Notify us promptly if
      you suspect unauthorized access to your account.`,
  },
];

const TermsOfService = ({ onNavigate }) => (
  <div className="flex min-h-screen flex-col bg-canvas">
    <PublicHeader overlay currentTab="terms" onNavigate={onNavigate} />
    <PageHero
      id="terms-title"
      eyebrow="Using the clinic"
      title={<>Terms of <span className="text-gradient-aurora">service</span></>}
      subtitle="The terms that apply when you book appointments, receive services, or make payments through Enlogada Ultrasound & Diagnostic Clinic."
    />
    <LegalDocument sections={SECTIONS} contactPrompt="Questions about these terms? Email us at" />
    <PublicFooter onNavigate={onNavigate} />
  </div>
);

export default TermsOfService;
