import React from 'react';
import { cn } from '../../lib/utils';
import { passwordStrength } from '../../lib/passwordStrength';

// One colour per score. The line under the bars always says the same thing in words, so colour is
// never the only signal: a reader who cannot tell rose from amber still reads "Too short".
const FILL = ['', 'bg-rose-500', 'bg-amber-500', 'bg-azure-500', 'bg-primary'];

/**
 * Four bars and a line of text under the new-password field. [1.72.0]
 *
 * Advice, not a gate: see lib/passwordStrength.js for why the only thing it states as a rule is
 * the one rule the server enforces. The text is the field's description (`id` is referenced by
 * the input's aria-describedby) rather than a live region, so it is read when the field is
 * reached instead of being announced on every keystroke.
 */
export default function PasswordMeter({ id, password }) {
  const { score, label } = passwordStrength(password);
  return (
    <div className="mt-2">
      <div aria-hidden="true" className="grid grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className={cn('h-1 rounded-full bg-slate-200 transition-colors duration-300', n <= score && FILL[score])}
          />
        ))}
      </div>
      <p id={id} className="m-0 mt-1 text-fine text-slate-500">
        {label}
      </p>
    </div>
  );
}
