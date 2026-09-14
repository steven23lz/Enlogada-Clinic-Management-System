import React from 'react';
import { Panel, PanelHeader } from '../ui/panel';
import { cn } from '../../lib/utils';

/**
 * The small pieces the Today sections share. [1.77.0]
 */

/**
 * A section's name, shown only on a Today with more than one section (a Receptionist who is also a
 * Cashier). With one, the rail's group heading already says it, and saying it again on the page
 * would be the same two words twice.
 */
export function TodaySection({ heading, children }) {
  return (
    <section aria-label={heading || undefined} className="space-y-4">
      {heading && (
        <h2 className="m-0 border-b border-line pb-2 text-micro font-semibold uppercase tracking-[0.14em] text-slate-500">
          {heading}
        </h2>
      )}
      {children}
    </section>
  );
}

/** Two columns from `lg`: the work on the left, what supports it on the right. */
export function TodayColumns({ left, right }) {
  if (!right) return <div className="space-y-4">{left}</div>;
  if (!left) return <div className="space-y-4">{right}</div>;
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
      <div className="min-w-0 space-y-4 lg:col-span-3">{left}</div>
      <div className="min-w-0 space-y-4 lg:col-span-2">{right}</div>
    </div>
  );
}

/**
 * A titled list of label / value lines — the takings, the week's hours, the best sellers.
 *
 * `failed` replaces the lines with one sentence saying what did not load. No Try again of its own:
 * the page has one Refresh, and a button here would be the second way to do the same thing on the
 * same screen. [1.74.0]
 */
export function LinesPanel({ title, hint, rows = [], failed, failedText, loading, emptyText, testId }) {
  return (
    <Panel data-testid={testId}>
      <PanelHeader title={title} actions={hint ? <span className="text-fine text-slate-500">{hint}</span> : undefined} />
      {failed ? (
        <p role="alert" className="m-0 px-5 py-4 text-fine font-medium text-rose-700">{failedText}</p>
      ) : loading ? (
        <p className="m-0 px-5 py-4 text-fine text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="m-0 px-5 py-4 text-fine text-slate-500">{emptyText}</p>
      ) : (
        <dl className="m-0 divide-y divide-line">
          {rows.map((row) => (
            <div key={row.key || row.label} className={cn('flex items-baseline gap-3 px-5 py-2.5', row.strong && 'bg-slate-50/70')}>
              <dt className={cn('min-w-0 flex-1 text-note', row.strong ? 'font-bold text-slate-900' : 'text-slate-700')}>
                {row.label}
                {row.note && <span className="ml-1.5 text-fine font-normal text-slate-500">{row.note}</span>}
              </dt>
              <dd className={cn('m-0 flex-shrink-0 text-note tabular-nums', row.strong ? 'font-bold text-slate-900' : 'font-semibold text-slate-800')}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}
