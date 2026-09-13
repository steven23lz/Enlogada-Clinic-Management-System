import React from 'react';
import { useClinic } from '../../lib/clinic';
import { useClinicHours } from '../../hooks/useClinicHours';
import { formatTime12 } from '../../lib/date';
import { cn } from '../../lib/utils';

// Monday first. The endpoint numbers days from Sunday, which is how a database counts them and not
// how a clinic's week reads.
const mondayFirst = (a, b) => ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7);

/**
 * The clinic's week, read live from Clinic Schedule. [1.72.0]
 *
 * The FAQ and the About page both show it, and both through this, so the two can never state
 * different hours — and neither can go stale when an admin changes them. While loading it says so;
 * when the hours cannot be read, or no day is open, it gives the phone number instead of presenting
 * an empty week as though the clinic never opens.
 *
 * `children` appear under the list, and only when the list does — a note about holidays means
 * nothing under "please call us".
 */
export default function ClinicHours({ className, children }) {
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
      <ul className={cn('m-0 list-none p-0', className)}>
        {[...week].sort(mondayFirst).map((d) => (
          <li key={d.dayOfWeek} className="flex justify-between gap-6 border-b border-line-soft py-1.5 last:border-0">
            <span className="font-semibold text-ink">{d.dayName}</span>
            <span className="tabular-nums">
              {d.isOpen ? `${formatTime12(d.openTime)} – ${formatTime12(d.closeTime)}` : 'Closed'}
            </span>
          </li>
        ))}
      </ul>
      {children}
    </>
  );
}
