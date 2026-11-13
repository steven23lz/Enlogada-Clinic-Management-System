import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * A note on a booking in the patient portal. [1.167.0]
 *
 * On a phone it is a line with an icon and no frame: the booking around it is already a section,
 * and every note drawn as its own box is how the Visits tab came to nest boxes four deep (Steven's
 * adviser: too many containers). From `sm` it is the box it always was, so desktop is unchanged.
 */
const TONES = {
  warning: { box: 'sm:rounded-lg sm:border sm:border-amber-200 sm:bg-amber-50 sm:p-2.5 sm:text-amber-800', icon: 'text-amber-600', Icon: AlertTriangle },
  info: { box: 'sm:rounded-lg sm:border sm:border-azure-200 sm:bg-azure-50 sm:p-2.5 sm:text-azure-900', icon: 'text-azure-600', Icon: Info },
  neutral: { box: 'sm:rounded-lg sm:border sm:border-line sm:bg-slate-100 sm:p-2.5 sm:text-slate-700', icon: 'text-slate-500', Icon: Info },
};

export default function PortalNote({ tone = 'neutral', icon, className, children, ...props }) {
  const t = TONES[tone] || TONES.neutral;
  const Icon = icon || t.Icon;
  return (
    <p className={cn('m-0 flex gap-2.5 text-fine text-slate-700 max-sm:leading-relaxed sm:block', t.box, className)} {...props}>
      <Icon className={cn('mt-0.5 h-4 w-4 flex-shrink-0 sm:hidden', t.icon)} aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
