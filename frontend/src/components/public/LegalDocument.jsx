import React from 'react';
import PageShell from '../ui/page-shell';
import DecorBlobs from './DecorBlobs';
import Reveal from './Reveal';
import { useClinic } from '../../lib/clinic';
import { scrollToSection } from '../../lib/scroll';

/**
 * The body of a legal page — Privacy Policy, Terms of Service. [1.72.0]
 *
 * Each section is a readable card with its own heading, and on a wide screen an "On this page" list
 * stays beside them, so somebody looking for one answer ("who can see my results?") goes straight
 * to it. On a phone the list is left out: four short sections are quicker to scroll than to pick
 * from.
 *
 *   sections       [{ id, icon, title, body }] — `id` is the anchor, `body` plain prose
 *   contactPrompt  the words before the clinic's email, e.g. "Questions about this policy? Email us at"
 *
 * The email is the clinic's live one. These pages typed it in, so a corrected address would have
 * gone on being printed here while every other page said the new one.
 */
export default function LegalDocument({ sections, contactPrompt }) {
  const CLINIC = useClinic();

  return (
    <main className="wash-aurora relative flex-1 overflow-hidden">
      <DecorBlobs />
      <PageShell className="relative py-14 sm:py-20">
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="On this page" className="hidden lg:block">
            {/* top-28 keeps it below the floating header while the page scrolls under it. */}
            <div className="sticky top-28">
              <p className="m-0 text-meta font-bold uppercase tracking-[0.16em] text-ink-muted">On this page</p>
              <ol className="m-0 mt-4 list-none space-y-1 border-l border-line p-0">
                {sections.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => scrollToSection(s.id)}
                      className="-ml-px block w-full cursor-pointer border-0 border-l-2 border-transparent bg-transparent py-1.5 pl-4 text-left text-note font-medium text-ink-soft transition-colors hover:border-brand-500 hover:text-ink"
                    >
                      {s.title}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </nav>

          <div className="space-y-5">
            {sections.map(({ id, icon: Icon, title, body }, i) => (
              <Reveal
                as="section"
                key={id}
                id={id}
                aria-labelledby={`${id}-title`}
                index={i < 2 ? i : 0}
                // scroll-mt-28: where "On this page" lands it, clear of the floating header.
                className="edge-gradient scroll-mt-28 rounded-2xl p-6 sm:p-8"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-brand-100 to-azure-100 text-brand-700"
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <h2 id={`${id}-title`} className="m-0 text-xl font-bold tracking-tight text-ink">
                    {title}
                  </h2>
                </div>
                <p className="m-0 mt-4 text-sm leading-relaxed text-ink-soft sm:text-base">{body}</p>
              </Reveal>
            ))}

            <Reveal as="p" className="m-0 pt-2 text-center text-note text-ink-soft">
              {contactPrompt}{' '}
              <a
                href={`mailto:${CLINIC.email}`}
                className="font-semibold text-brand-700 no-underline [overflow-wrap:anywhere] hover:underline"
              >
                {CLINIC.email}
              </a>
              .
            </Reveal>
          </div>
        </div>
      </PageShell>
    </main>
  );
}
