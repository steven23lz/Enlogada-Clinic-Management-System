import React, { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Questions that open in place. [1.72.0]
 *
 * Built on the app's existing `.disclosure` (index.css): a grid-rows 0fr → 1fr transition, so an
 * answer of any length opens at the same pace without anyone measuring it. A closed answer is
 * `inert` rather than `hidden`, as in TestPicker — `hidden` is display:none, which removes the
 * height the animation travels to, and the answer would jump instead of opening.
 *
 * Several can be open at once. A patient comparing "do I need to fast" with "how do I pay" should
 * not have one snap shut when they open the other.
 *
 *   items  [{ question: string, answer: ReactNode }]
 */
export default function FaqAccordion({ items, className }) {
  const baseId = useId();
  const [open, setOpen] = useState(() => new Set());

  const toggle = (i) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className={cn('edge-gradient divide-y divide-line overflow-hidden rounded-2xl', className)}>
      {items.map((item, i) => {
        const isOpen = open.has(i);
        const buttonId = `${baseId}-q${i}`;
        const panelId = `${baseId}-a${i}`;
        return (
          <div key={item.question}>
            <h3 className="m-0">
              <button
                id={buttonId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(i)}
                className="flex w-full cursor-pointer items-center justify-between gap-4 border-0 bg-transparent px-5 py-4 text-left text-sm font-semibold text-ink transition-colors hover:bg-sunken sm:px-6 sm:text-base"
              >
                <span>{item.question}</span>
                <Plus
                  aria-hidden="true"
                  className={cn('h-4 w-4 flex-shrink-0 text-brand-700 transition-transform duration-200', isOpen && 'rotate-45')}
                />
              </button>
            </h3>
            <div className="disclosure" data-open={isOpen}>
              <div id={panelId} role="region" aria-labelledby={buttonId} inert={!isOpen}>
                <div className="px-5 pb-5 text-note leading-relaxed text-ink-soft sm:px-6">{item.answer}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
