import React, { forwardRef, useState } from 'react';
import { cn } from '../../lib/utils';

export const CODE_LENGTH = 6;

/**
 * The 6-digit code from the email: ONE real input, drawn as six boxes. [1.73.0]
 *
 * One input rather than six, because six break the things people actually do with a code:
 *   - pasting it, which a row of boxes has to catch in one box and spread across the rest;
 *   - a phone offering it from the email — `autocomplete="one-time-code"` fills ONE field;
 *   - a screen reader, which should hear "Verification code, edit text", not six unlabelled boxes;
 *   - Backspace, which should just delete the last digit.
 *
 * The boxes are decoration (aria-hidden) drawn from the input's value. The input lies on top of
 * them, transparent, so a tap anywhere on the row focuses it; the blinking caret in the next empty
 * box stands in for the input's own, which cannot be seen.
 *
 * `onComplete` fires when the sixth digit arrives, with the whole code, so a form can submit
 * itself without waiting for a state update to land.
 */
const CodeInput = forwardRef(function CodeInput(
  { id, value, onChange, onComplete, disabled, invalid, describedBy, autoFocus },
  ref
) {
  const [focused, setFocused] = useState(false);

  const handleChange = (event) => {
    // Digits only, however it arrived: "123 456" and "123-456" pasted both become 123456.
    const next = event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    onChange(next);
    if (next.length === CODE_LENGTH && value.length !== CODE_LENGTH) onComplete?.(next);
  };

  const active = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <div className="relative">
      <input
        ref={ref}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={CODE_LENGTH}
        spellCheck={false}
        value={value}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        // text-base: under 16px, iOS zooms the page when the field is focused.
        className="absolute inset-0 z-10 h-full w-full cursor-text border-0 bg-transparent text-base opacity-0 outline-none disabled:cursor-not-allowed"
      />
      <div aria-hidden="true" className="grid grid-cols-6 gap-2">
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const digit = value[i] || '';
          const isActive = focused && i === active;
          return (
            <span
              key={i}
              className={cn(
                'flex h-12 items-center justify-center rounded-xl border bg-surface text-xl font-semibold tabular-nums text-slate-900 transition-[border-color,box-shadow] duration-150',
                invalid
                  ? 'border-rose-300'
                  : isActive
                    ? 'border-azure-400 ring-4 ring-azure-500/12'
                    : digit
                      ? 'border-slate-300'
                      : 'border-slate-200',
                disabled && 'opacity-60'
              )}
            >
              {digit || (isActive ? <span className="code-caret" /> : null)}
            </span>
          );
        })}
      </div>
    </div>
  );
});

export default CodeInput;
