import React from 'react';
import FaqAccordion from './FaqAccordion';
import { useClinic } from '../../lib/clinic';
import { useClinicHours } from '../../hooks/useClinicHours';
import { formatTime12 } from '../../lib/date';

/**
 * The clinic's FAQ, on Home. [1.72.0]
 *
 * Every answer states something the system itself does, or already says somewhere else — nothing
 * here is a promise invented for a marketing page. Where a fact can change, it is read live: the
 * hours come from Clinic Schedule and the contact details from the clinic identity, so neither can
 * go stale on this page while being corrected everywhere else.
 *
 * Deliberately NOT claimed: the day-before reminder. sendAppointmentReminders.js only runs if the
 * clinic has scheduled it, and a page promising a reminder that never arrives is worse than one
 * that does not mention it.
 */

const LINK = 'font-semibold text-brand-700 underline-offset-2 hover:underline';

// Monday first. The endpoint numbers days from Sunday, which is how a database counts them and not
// how a clinic's week reads.
const mondayFirst = (a, b) => ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7);

function HoursAnswer() {
  const CLINIC = useClinic();
  const { week, failed } = useClinicHours();

  if (week === null) return <p className="m-0">Loading the clinic&apos;s hours…</p>;

  if (failed || !week.some((d) => d.isOpen)) {
    return (
      <p className="m-0">
        Please call us on <strong className="text-ink">{CLINIC.phone}</strong> for our hours.
      </p>
    );
  }

  return (
    <>
      <ul className="m-0 max-w-sm list-none p-0">
        {[...week].sort(mondayFirst).map((d) => (
          <li key={d.dayOfWeek} className="flex justify-between gap-6 border-b border-line-soft py-1.5 last:border-0">
            <span className="font-semibold text-ink">{d.dayName}</span>
            <span className="tabular-nums">
              {d.isOpen ? `${formatTime12(d.openTime)} – ${formatTime12(d.closeTime)}` : 'Closed'}
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-3">
        Holidays and other closed dates are marked on the booking calendar before you pick a time.
      </p>
    </>
  );
}

export default function ClinicFaq() {
  const CLINIC = useClinic();
  const tel = CLINIC.phone.replace(/\s/g, '');

  const items = [
    {
      question: 'Do I need an appointment, or can I walk in?',
      answer: (
        <p className="m-0">
          Either. Walk-ins are welcome during clinic hours and join the queue at the front desk. Booking
          online reserves a time for you and tells you exactly when to arrive.
        </p>
      ),
    },
    { question: 'What are your clinic hours?', answer: <HoursAnswer /> },
    {
      question: 'Do I need to prepare before my test?',
      answer: (
        <p className="m-0">
          Some tests do — fasting before certain blood tests, or a full bladder for some ultrasounds. The
          instruction is printed beside each test on the price list, and shown again when you book.
        </p>
      ),
    },
    {
      question: 'How will I get my results?',
      answer: (
        <p className="m-0">
          Released results are emailed to the address on your record. If you have an account, they are
          also saved in your patient portal, where you can view and print them at any time.
        </p>
      ),
    },
    {
      question: 'Do you accept HMO?',
      answer: (
        <p className="m-0">
          Yes, we work with accredited HMO providers. Bring your HMO card to the front desk. If you book
          online with HMO, you will be asked for a photo of your card so the claim can be raised.
        </p>
      ),
    },
    {
      question: 'How can I pay?',
      answer: (
        <p className="m-0">
          At the counter by cash, GCash or bank transfer. If you book online you can also pay into the
          clinic&apos;s own GCash or bank account and upload the proof; a cashier confirms it before your
          booking pass is issued.
        </p>
      ),
    },
    {
      question: 'Do senior citizens and PWDs get a discount?',
      answer: (
        <p className="m-0">
          Yes. The 20% Senior Citizen and PWD discount is applied at the counter when you present your ID.
        </p>
      ),
    },
    {
      question: 'How do I contact the clinic?',
      answer: (
        <p className="m-0">
          Call <a href={`tel:${tel}`} className={LINK}>{CLINIC.phone}</a>, email{' '}
          <a href={`mailto:${CLINIC.email}`} className={`${LINK} [overflow-wrap:anywhere]`}>{CLINIC.email}</a>, or visit
          us at {CLINIC.address}.
        </p>
      ),
    },
  ];

  return <FaqAccordion items={items} />;
}
