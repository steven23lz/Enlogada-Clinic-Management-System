import React from 'react';
import { formatCurrency } from '../../lib/currency';

/**
 * The day's money, as one line across the top of the till. [1.75.0]
 *
 * It was five metric cards: the biggest thing on the busiest screen, with the cashier's actual work
 * — the queue and the bill — pushed below them. Option C3 ("the same screens, tidied") keeps every
 * figure and gives the room back.
 *
 * Every figure comes from the endpoint's SQL summary, never from reducing the transaction list.
 * Under the cash book [1.30.0] that list matches the range on EITHER date, so it also holds receipts
 * taken on an earlier day and only reversed inside this one — money that was never part of today's
 * takings. Summing the rows would count it as though it were.
 *
 * Three rules carried over from the cards:
 *   - Bank is always listed. With only Cash and GCash shown, a day carrying a transfer did not add
 *     up to its own total, and the difference was nowhere on screen.
 *   - "Receipts" counts receipts ISSUED, reversed ones included, because they were money when they
 *     were taken. A reversal is named beside it ("incl. above"), never quietly subtracted.
 *   - Net in drawer appears only when something was reversed. On a normal day it equals Collected,
 *     and two identical figures side by side teach a cashier to stop reading both.
 *
 * No summary means no figures: "—", never ₱0.00. [1.74.0] The queue panel below says why, once.
 */
export default function CollectionsStrip({ queue }) {
  const s = queue.summary;
  const missing = Boolean(queue.collectionsError) || !s;
  const money = (value) => (missing ? '—' : formatCurrency(Number(value || 0)));
  const reversals = missing ? 0 : Number(s.reversals || 0);
  const collected = missing ? 0 : Number(s.collected || 0);
  const reversed = missing ? 0 : Number(s.reversed || 0);

  // A <div>, not a <p m-0>: `m-0` cancels the bottom margin the page's `space-y` gives every
  // section, and the line sat flush against the panels below it.
  return (
    <div
      aria-label="Today's collections"
      className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-xl border border-line bg-surface px-4 py-2.5 text-note text-slate-500"
    >
      <Figure label="Collected Today" value={money(s?.collected)} lead />
      <Figure label="Receipts" value={missing ? '—' : Number(s.receipts || 0)} />
      <Figure label="Cash" value={money(s?.cash)} />
      <Figure label="GCash" value={money(s?.ewallet)} />
      <Figure label="Bank" value={money(s?.bank)} />
      {reversals > 0 && (
        <>
          <Figure label={`Reversed (${reversals}, incl. above)`} value={formatCurrency(reversed)} tone="rose" />
          <Figure label="Net in drawer" value={formatCurrency(collected - reversed)} lead />
        </>
      )}
    </div>
  );
}

const Figure = ({ label, value, lead = false, tone }) => (
  <span className="whitespace-nowrap">
    {label}{' '}
    <b className={`${lead ? 'text-lead' : 'text-note'} font-extrabold tabular-nums ${tone === 'rose' ? 'text-rose-700' : 'text-slate-900'}`}>
      {value}
    </b>
  </span>
);
