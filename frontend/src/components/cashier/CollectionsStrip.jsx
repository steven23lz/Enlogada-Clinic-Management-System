import React from 'react';
import { Banknote, DollarSign, Receipt, Wallet } from 'lucide-react';
import MetricCard from '../ui/metric-card';
import { formatCurrency } from '../../lib/currency';

/**
 * The day's money, across the top of the billing screen.
 *
 * Lifted out of CashierDashboard, which rendered the whole till, the queue beside it and
 * the transaction log from one 971-line file. The props are the hooks this piece reads —
 * listed rather than reached for, so its dependencies are visible at the top.
 * 
 * Every figure comes from the endpoint's SQL summary, never from reducing the
 * transaction list: that list is a log of receipts ISSUED and includes ones later
 * reversed, so adding it up would report refunded money as revenue.
 */
export default function CollectionsStrip({ queue }) {
  // Straight off the endpoint's SQL summary. Reducing `queue.transactions` instead would count
  // reversed receipts as revenue — that list is a log of what was ISSUED, not what was kept.
  const totalCollectionsToday = Number(queue.summary?.collected || 0);
  const cashTotal = Number(queue.summary?.cash || 0);
  const eWalletTotal = Number(queue.summary?.ewallet || 0);
  const bankTotal = Number(queue.summary?.bank || 0);
  const receiptsSettled = Number(queue.summary?.receipts || 0);
  const reversalCount = Number(queue.summary?.reversals || 0);

  return (
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {/* The caption closes a reconciliation gap rather than decorating the tile. Only Cash
            and E-Wallet have tiles, but chk_payment_method also allows Bank — so on any day
            carrying a transfer, the two tiles below simply did not add up to this one and the
            difference was nowhere on screen. Today that difference was ₱200.00. */}
        <MetricCard
          label="Collected Today"
          value={formatCurrency(totalCollectionsToday)}
          caption={bankTotal > 0 ? `incl. ${formatCurrency(bankTotal)} bank transfer` : undefined}
          captionTone={bankTotal > 0 ? 'slate' : undefined}
          icon={DollarSign}
          tone="green"
        />
        <MetricCard label="Cash Collected" value={formatCurrency(cashTotal)} icon={Banknote} tone="emerald" />
        <MetricCard label="E-Wallet" value={formatCurrency(eWalletTotal)} caption="GCash + PayMaya" captionTone="slate" icon={Wallet} tone="indigo" />
        {/* "Receipts Settled", not "Receipts Issued": this counts rows the drawer should
            hold, and a receipt that was issued and then reversed is not one of them. The old
            label described the log below, while the number described the money — the exact
            mismatch this whole change exists to remove. */}
        <MetricCard
          label="Receipts Settled"
          value={receiptsSettled}
          caption={reversalCount > 0 ? `${reversalCount} more issued, then reversed` : undefined}
          captionTone={reversalCount > 0 ? 'rose' : undefined}
          icon={Receipt}
          tone="slate"
        />
      </div>
  );
}
