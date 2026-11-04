import React from 'react';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import PageHero from '../../components/public/PageHero';
import LegalDocument from '../../components/public/LegalDocument';
import { Calendar, CreditCard, FileCheck, AlertCircle } from 'lucide-react';

// The terms' words were unchanged by the [1.72.0] restyle. [1.151.0] Two sections brought into line
// with how the clinic works: nothing is cancelled since [1.131.0], and a booking is paid first.
const SECTIONS = [
  {
    id: 'appointments',
    icon: Calendar,
    title: 'Appointments & Changes',
    body: `An appointment booked through this system is kept once it is paid, or once your HMO approves
      it. Until then it holds its date and time only for the time to pay shown when you book, and is then
      released so the slot can be offered to another patient. You may release an unpaid booking yourself.
      A paid booking can be moved to another time through your account or by contacting the clinic.`,
  },
  {
    id: 'billing',
    icon: CreditCard,
    title: 'Billing & Payment',
    body: `Prices shown for each test reflect the rate at the time of your visit and may change for future
      visits. HMO coverage is applied per test based on an approved pre-authorization on file; any portion
      not covered is payable at the clinic. A booking made online is paid within the time shown when you
      book, and a walk-in visit is paid before its tests go ahead. A paid receipt is final: the tests on
      it cannot be changed and the payment is not refunded, so please check your tests before you pay.`,
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
