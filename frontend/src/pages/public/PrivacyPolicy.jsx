import React from 'react';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import PageHero from '../../components/public/PageHero';
import LegalDocument from '../../components/public/LegalDocument';
import { ShieldCheck, Lock, Eye, Mail } from 'lucide-react';

// The policy's words are unchanged by the [1.72.0] restyle; only the page around them is new.
const SECTIONS = [
  {
    id: 'what-we-collect',
    icon: Eye,
    title: 'What We Collect',
    body: `When you register an account, book an appointment, or visit the clinic, we collect the personal
      and medical information needed to provide diagnostic services — your name, contact details, birthdate,
      address, and the test results, findings, and visit history tied to your patient record. Payment
      transactions record the amount, method, and reference number, not full card or account details.`,
  },
  {
    id: 'how-we-use-it',
    icon: Lock,
    title: 'How We Use It',
    body: `Your information is used to register and check you in for visits, bill for services rendered,
      release diagnostic results to you and to staff directly involved in your care, and to send
      appointment or result-ready notifications. We do not sell patient data, and we do not use it for
      advertising.`,
  },
  {
    id: 'who-can-see-it',
    icon: ShieldCheck,
    title: 'Who Can See It',
    body: `Access is role-based: front-desk staff see visit and scheduling details, diagnostic staff see
      only the test categories relevant to their department, and billing staff see payment information.
      Your diagnostic results are visible to you and to the staff who processed them. Administrative roles
      oversee the system for clinic operations, not to read individual results without cause.`,
  },
  {
    id: 'your-rights',
    icon: Mail,
    title: 'Your Rights',
    body: `Under the Philippine Data Privacy Act of 2012, you may request access to, correction of, or
      deletion of your personal data, subject to our recordkeeping obligations as a healthcare provider.
      To make a request, contact us using the details below.`,
  },
];

const PrivacyPolicy = ({ onNavigate }) => (
  <div className="flex min-h-screen flex-col bg-canvas">
    <PublicHeader overlay currentTab="privacy" onNavigate={onNavigate} />
    <PageHero
      id="privacy-title"
      eyebrow="Your data"
      title={<>Privacy <span className="text-gradient-aurora">policy</span></>}
      subtitle="How Enlogada Ultrasound & Diagnostic Clinic collects, uses, and protects your personal and medical information."
    />
    <LegalDocument sections={SECTIONS} contactPrompt="Questions about this policy? Email us at" />
    <PublicFooter onNavigate={onNavigate} />
  </div>
);

export default PrivacyPolicy;
