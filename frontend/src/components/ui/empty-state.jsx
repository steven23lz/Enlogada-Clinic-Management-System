import React from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * What a screen shows when there is nothing to show.
 *
 * The app had thirty-odd variants of a centred line of small italic grey text reading "No records
 * found." Three problems with that, all of which matter more in a clinic than in most software:
 *
 *  1. It is indistinguishable from a failure. A receptionist looking at an empty queue cannot
 *     tell "nobody is waiting" from "the request failed and nobody told you", and those call for
 *     opposite responses.
 *  2. Italic grey 11px centred in a large panel reads as an error message, so a genuinely quiet
 *     morning looks like something is broken.
 *  3. Empty is the state a new member of staff sees first, and "No records found" teaches them
 *     nothing about what would put records there.
 *
 * So: a glyph to mark it as deliberate, a plain statement of the situation, and — where there is
 * one — the action that fills it. `tone="error"` is visibly different from empty, because the
 * whole point is that those two must never look alike.
 */
const EmptyState = ({
  icon: Icon = Inbox,
  title,
  description,
  action,
  tone = 'default',
  compact = false,
  className,
}) => {
  const isError = tone === 'error';

  return (
    <div
      role={isError ? 'alert' : undefined}
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-8' : 'py-14',
        className
      )}
    >
      <span
        className={cn(
          'mb-3 flex items-center justify-center rounded-xl',
          compact ? 'h-9 w-9' : 'h-11 w-11',
          isError ? 'bg-rose-50 text-rose-500 ring-1 ring-rose-200' : 'bg-slate-100 text-slate-400'
        )}
      >
        <Icon className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
      </span>
      <p className={cn('m-0 text-note font-semibold', isError ? 'text-rose-800' : 'text-slate-700')}>{title}</p>
      {description && (
        <p className={cn('m-0 mt-1 max-w-sm text-fine leading-relaxed', isError ? 'text-rose-700' : 'text-slate-500')}>
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
};

export default EmptyState;
