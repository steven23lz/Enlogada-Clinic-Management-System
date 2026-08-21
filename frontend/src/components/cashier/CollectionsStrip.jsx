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
 * transaction list. Under the cash book [1.30.0] that list matches the range on
 * EITHER date, so it also holds receipts taken on an earlier day and only reversed
 * inside this one — money that was never part of today's takings. Summing the rows
 * would count it as though it were.
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
  const reversedAmount = Number(queue.summary?.reversed || 0);

  return (
      // Five columns on a shift with a reversal, four otherwise — the Net in Drawer tile only
      // appears when it says something Collected Today does not.
      <div className={`grid grid-cols-2 gap-4 ${reversalCount > 0 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
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
        {/* "Receipts Issued" is what this counts, and saying so is a correction. [1.30.0]

            It read "Receipts Settled", arguing that a receipt issued and then reversed is not one
            the drawer should hold. That was true of the old query and the cash book made it
            false: `receipts` FILTERs on `issued`, which does not test payment_status, so a
            reversed receipt IS counted here — deliberately, because it was money when it was
            taken. The caption said "N more issued, then reversed", and "more" was the sharper
            error: on a same-day reversal those N are not additional, they are already inside the
            number above them. */}
        <MetricCard
          label="Receipts Issued"
          value={receiptsSettled}
          caption={reversalCount > 0 ? `${reversalCount} reversed, incl. above` : undefined}
          captionTone={reversalCount > 0 ? 'rose' : undefined}
          icon={Receipt}
          tone="slate"
        />
        {/* Only when something was reversed, matching the shift panel's own rule: on a normal
            day this equals Collected exactly, and two identical tiles side by side teach a
            cashier to stop reading both. On the day it differs, it is the number they count the
            drawer against — and the one figure the cash book does not state anywhere else,
            because `reversed` is reported beside `collected` and never subtracted from it. */}
        {reversalCount > 0 && (
          <MetricCard
            label="Net in Drawer"
            value={formatCurrency(totalCollectionsToday - reversedAmount)}
            caption={`${formatCurrency(totalCollectionsToday)} less ${formatCurrency(reversedAmount)} reversed`}
            captionTone="slate"
            icon={Wallet}
            tone="green"
          />
        )}
      </div>
  );
}
