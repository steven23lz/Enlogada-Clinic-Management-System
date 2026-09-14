import React from 'react';

/**
 * The day at the desk, in one line. [1.75.0]
 *
 * These were four metric cards: the largest thing on the landing screen, and reading 0 for most of
 * the morning. A line of text says the same and gives the room to the Who's here box and the queue,
 * which are what the desk works from (option F1). The figures are the server's own —
 * `/visits/active` counts across the whole queue, not the page in hand.
 *
 * No count of today's bookings here: the Who's here box lists them, and a number beside the list it
 * counts is the same fact twice.
 *
 * Hidden while the queue is filtered: the server counts what MATCHES, so "3 in the queue" under a
 * search for a surname would describe the search, not the day. The toolbar says "Showing N of M"
 * in that case instead, and only then.
 *
 * "—" when the queue could not load, never the 0 the counters start at. [1.74.0]
 */
export default function DeskCounts({ queue }) {
  if (queue.search || queue.status !== 'All') return null;

  const firstLoad = queue.loading && queue.total === 0 && !queue.error;
  const shown = (n) => (queue.error ? '—' : firstLoad ? '…' : n);
  const items = [
    [shown(queue.total), 'in the queue'],
    [shown(queue.pendingCount), 'not yet paid'],
    [shown(queue.processingCount), 'in a department'],
    [shown(queue.walkinCount), 'walk-ins'],
  ];

  // A <div>, not a <p m-0>: `m-0` would cancel the bottom margin the page's `space-y` puts under
  // every section, and this line sat flush against the panel below it.
  return (
    <div
      aria-label="Today at the desk"
      className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-xl border border-line bg-surface px-4 py-2.5 text-note text-slate-500"
    >
      {items.map(([value, label]) => (
        <span key={label} className="whitespace-nowrap">
          <b className="text-lead font-extrabold tabular-nums text-slate-900">{value}</b>{' '}{label}
        </span>
      ))}
    </div>
  );
}
