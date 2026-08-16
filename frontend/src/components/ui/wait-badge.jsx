import React from 'react';
import { Clock, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatDuration, minutesSince } from '../../lib/duration';

// How long a patient has been waiting, shown the same way in every queue.
//
// In a clinic the oldest ticket usually IS the priority, so this is the one number that should
// decide what staff pick up next. It previously existed only on the billing queue, hand-rolled
// inside CashierDashboard, and the modality worklists showed no waiting time at all — a patient
// could sit in Laboratory indefinitely with nothing on screen saying so.
//
// Escalation is carried by an icon change as well as colour, for the same reason the status
// badges are: a red pill and an amber pill are the same pale rectangle on a bright reception
// monitor, and to a red-green colour blind user the "fine" and "overdue" states were the two
// hardest to tell apart of the whole set.

const THRESHOLDS = [
  // Ordered longest-first; the first match wins.
  { minAge: 60, tone: 'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-300', icon: AlertTriangle, label: 'Waiting over an hour' },
  { minAge: 30, tone: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200', icon: AlertTriangle, label: 'Waiting over 30 minutes' },
  { minAge: 15, tone: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200', icon: Clock, label: 'Waiting over 15 minutes' },
  { minAge: 0, tone: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200', icon: Clock, label: 'Recently arrived' },
];

// formatWaitDuration and minutesSince moved to lib/duration.js when the operations report needed
// the same formatting. Re-exported here so existing importers are unaffected.
export { minutesSince };
export const formatWaitDuration = formatDuration;
const WaitBadge = ({ since, className }) => {
  const minutes = minutesSince(since);
  // An unparseable or absent timestamp renders nothing rather than "NaNm" or a misleading 0m.
  if (minutes === null) return null;

  const level = THRESHOLDS.find((t) => minutes >= t.minAge) ?? THRESHOLDS[THRESHOLDS.length - 1];
  const Icon = level.icon;

  return (
    <span
      title={level.label}
      className={cn(
        // Squared to match StatusBadge — the two sit side by side in every queue row, and one
        // being a pill while the other is a tag made them look like different kinds of thing.
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-micro font-semibold tabular-nums leading-5',
        level.tone,
        className
      )}
    >
      <Icon aria-hidden="true" className="w-3 h-3 flex-shrink-0" />
      {formatWaitDuration(minutes)} waiting
    </span>
  );
};

export default WaitBadge;
