import { clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * `cn()` — conditional classes, then conflict resolution.
 *
 * ── Why this is `extendTailwindMerge` and not plain `twMerge` ─────────────────────────────────
 *
 * tailwind-merge decides which of two conflicting classes wins by parsing the class name against
 * its own model of Tailwind. It knows nothing about a project's `@theme` block, so a custom token
 * gets guessed at — and for the `text-*` prefix it guesses wrong in the worst possible direction.
 *
 * `text-micro` is a FONT SIZE. tailwind-merge cannot tell "micro" from a colour name, files it
 * under text-colour, and then `cn('text-micro …', 'text-slate-500')` resolves the two as
 * conflicting colours and **drops the size entirely**. Measured on the cashier's Collections
 * strip: the label rendered at 16px inherited, not the 10px it asks for, which is why a row of
 * metric cards had labels louder than the figures they label. Every one of the seven custom sizes
 * behaved this way, in every component that reaches for `cn()` with a colour — which is most of
 * `components/ui/`.
 *
 * It is also exactly why this was invisible for so long: the app previously wrote these sizes as
 * arbitrary values (`text-[13px]`), and tailwind-merge parses `[13px]` as a length and correctly
 * files it as a font size. Moving onto named tokens is the right call for the reader's text-scale
 * setting ([1.38.0]) — `rem` tokens scale, pinned pixels do not — but it walked into this.
 *
 * Registering the theme keys makes tailwind-merge resolve them as what they are. Verified in both
 * directions: `text-sm text-note` → `text-note`, `text-note text-sm` → `text-sm`.
 *
 * The shadows had a quieter version of the same problem — unrecognised, so `shadow-float` and
 * `shadow-sm` did not conflict and BOTH applied, stacking two shadows on one element.
 *
 * Colours need no entry: an unknown `bg-*`/`text-*`/`border-*` colour already merges correctly,
 * because colour is the fallback guess. Radii are the built-in names, so they are known already.
 *
 * **If you add a token to a non-colour `@theme` namespace, add it here in the same commit** —
 * otherwise it works everywhere except the components that use `cn()`, which is the hardest kind
 * of inconsistency to spot.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      // Keep in sync with the `--text-*` block in index.css.
      text: ['nano', 'micro', 'meta', 'fine', 'note', 'lead', 'stat'],
      // Keep in sync with the `--shadow-*` block in index.css.
      shadow: ['raised', 'float', 'overlay', 'rail'],
    },
  },
})

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
