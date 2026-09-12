import React from 'react';
import { cn } from '../../lib/utils';

/**
 * One labelled field on the sign-in card: the label, an optional control on the label's right
 * ("Forgot password?"), the input with its icon, and anything that belongs under it. [1.72.0]
 *
 * `htmlFor` must match the input's `id`, so the visible label is the field's accessible name and
 * clicking it focuses the input. Both were decorative <label> elements with no association once —
 * on the one screen every single user has to get through — and getByLabel in the specs relies on it.
 *
 * The icon is decoration: hidden from assistive tech and click-through. The input needs `pl-10` to
 * clear it. `index` places the field in the card's entrance stagger (`.auth-rise` in index.css).
 */
export default function AuthField({ id, label, icon: Icon, action, index = 0, after, className, children }) {
  return (
    <div className={cn('auth-rise', className)} style={{ '--i': index }}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label htmlFor={id} className="block text-fine font-semibold text-slate-700">
          {label}
        </label>
        {action}
      </div>
      <div className="group relative">
        {/* z-10: PasswordInput wraps its input in a positioned box of its own, which would
            otherwise paint over an icon that comes before it. */}
        <Icon
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-azure-600"
        />
        {children}
      </div>
      {after}
    </div>
  );
}
