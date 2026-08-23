import React from 'react';
import { Type } from 'lucide-react';
import { TEXT_SCALES, setTextScale, useTextScale } from '../../lib/textScale';
import { cn } from '../../lib/utils';

/**
 * Lets whoever is reading the screen choose how large the text is.
 *
 * A segmented control rather than a dropdown, for one reason: the choice is about legibility, and
 * a dropdown hides the options behind a click at exactly the size the user is struggling with.
 * Three visible buttons let them see the effect immediately, and the change applies live as they
 * press each one — there is no Save.
 *
 * The control grows with its own setting, because everything around it in the header does too —
 * the bar's padding and its sibling buttons are all rem-based, so holding this one at fixed pixels
 * is what would look wrong. The three `A` glyphs are the exception: they are pinned in px because
 * they are an icon showing the relative sizes on offer, not text anyone reads.
 */
const TextScaleControl = ({ className, tone = 'light' }) => {
  const active = useTextScale();
  const dark = tone === 'dark';

  return (
    <div
      role="group"
      aria-label="Text size"
      data-testid="text-scale"
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border p-0.5',
        dark ? 'border-white/15 bg-white/5' : 'border-slate-200 bg-slate-50',
        className
      )}
    >
      <Type
        aria-hidden="true"
        className={cn('ml-1 mr-0.5 h-[13px] w-[13px] flex-shrink-0', dark ? 'text-white/50' : 'text-slate-400')}
      />
      {TEXT_SCALES.map((scale) => {
        const selected = scale.id === active;
        return (
          <button
            key={scale.id}
            type="button"
            onClick={() => setTextScale(scale.id)}
            aria-pressed={selected}
            // The visible letter grows across the three buttons, so the control shows what it does
            // without needing the words. The accessible name still carries them.
            aria-label={`${scale.label} text size`}
            title={`${scale.label} text`}
            className={cn(
              'flex h-6 w-6 cursor-pointer items-center justify-center rounded-md font-semibold leading-none transition-colors',
              selected
                ? dark
                  ? 'bg-white/15 text-white'
                  : 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                : dark
                  ? 'text-white/55 hover:bg-white/10 hover:text-white'
                  : 'text-slate-500 hover:bg-white hover:text-slate-800'
            )}
          >
            <span style={{ fontSize: `${9 + TEXT_SCALES.indexOf(scale) * 2}px` }}>A</span>
          </button>
        );
      })}
    </div>
  );
};

export default TextScaleControl;
