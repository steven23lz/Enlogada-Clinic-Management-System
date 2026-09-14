import React from 'react';
import { LinesPanel, TodayColumns, TodaySection } from './TodayParts';
import { formatCurrency } from '../../lib/currency';
import { topServices } from '../../lib/today';

const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;

/**
 * The till's Today. [1.77.0]
 *
 * The drawer so far, laid out the way a cash-up is done — each method, then the total, then what
 * went back out — and what sold. Every peso comes from the transactions endpoint's own `summary`,
 * aggregated in SQL; the receipt list is a log and is never added up here (see lib/collections.js).
 *
 * Yesterday is the WHOLE of yesterday, and says so. "Yesterday by now" would have to be summed from
 * the receipt list, which is exactly the thing a money figure must never come from.
 */
export default function TillToday({ paid, yesterday, ops, needs, heading }) {
  const s = paid.data?.summary;
  const before = yesterday.data?.summary;

  const takings = (
    <LinesPanel
      testId="today-takings"
      title="Today's takings"
      hint={before ? `Yesterday, whole day: ${formatCurrency(before.collected)}` : undefined}
      failed={paid.failed || (paid.data && !s)}
      failedText="Couldn't load today's takings."
      loading={paid.loading}
      rows={s ? [
        { label: 'Cash', value: formatCurrency(s.cash) },
        { label: 'GCash and e-wallets', value: formatCurrency(s.ewallet) },
        { label: 'Bank transfer', value: formatCurrency(s.bank) },
        { label: 'Collected today', note: plural(s.receipts, 'receipt'), value: formatCurrency(s.collected), strong: true },
        // Beside the total, never taken off it: a drawer short by a refund needs the refund named.
        { label: 'Reversed today', note: plural(s.reversals, 'receipt'), value: formatCurrency(s.reversed) },
        { label: 'Discounts given', note: 'already off the bills above', value: formatCurrency(s.discounts) },
      ] : []}
    />
  );

  const sold = topServices(ops.data?.billing?.byService || []);
  const best = (
    <LinesPanel
      testId="today-top-services"
      title="Top services today"
      failed={ops.failed || (ops.data && !ops.data.billing)}
      failedText="Couldn't load today's sales."
      loading={ops.loading}
      emptyText="Nothing sold yet today."
      rows={sold.map((r) => ({
        key: `${r.category_name}-${r.test_name}`,
        label: r.test_name,
        note: `×${r.sold}`,
        value: formatCurrency(r.net),
      }))}
    />
  );

  return (
    <TodaySection heading={heading}>
      <TodayColumns left={<>{needs}{takings}</>} right={best} />
    </TodaySection>
  );
}
