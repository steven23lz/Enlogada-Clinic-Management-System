import React from 'react';
import { History, Printer, Receipt, RefreshCw, Undo2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Panel, PanelHeader, PanelBody } from '../ui/panel';
import Toolbar, { ToolbarSpacer } from '../ui/toolbar';
import EmptyState from '../ui/empty-state';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { StatusBadge } from '../ui/status-badge';
import { SkeletonRows } from '../ui/skeleton';
import Pagination from '../ui/pagination';
import { formatDateTime } from '../../lib/date';
import { formatCurrency } from '../../lib/currency';
import { isCrossDayReversal } from '../../lib/collections';
import { BillingTotalsPanel, SalesByServicePanel } from '../reports/OperationsPanels';
import { HISTORY_PAGE_SIZE } from '../../hooks/useTransactionHistory';
import { DateField, RANGE_PRESETS } from '../ui/date-field';

/**
 * Receipts issued over a chosen range, for the daily cash-up.
 *
 * Lifted out of CashierDashboard, which rendered the whole till, the queue beside it and
 * the transaction log from one 971-line file. The props are the hooks this piece reads —
 * listed rather than reached for, so its dependencies are visible at the top.
 */
export default function TransactionHistoryPanel({ history, receipt, refund, operations }) {
  return (
      <div>
        <Toolbar attached>
          <DateField presets={RANGE_PRESETS.start} value={history.startDate} onChange={e => history.setStartDate(e.target.value)} containerClassName="w-[9.375rem]" aria-label="History start date" />
          <span className="text-fine text-slate-400">to</span>
          <DateField presets={RANGE_PRESETS.end} value={history.endDate} onChange={e => history.setEndDate(e.target.value)} containerClassName="w-[9.375rem]" aria-label="History end date" />
          <Button variant="outline" onClick={() => history.reload()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Apply
          </Button>
          <ToolbarSpacer />
          <span className="whitespace-nowrap text-fine font-medium tabular-nums text-slate-500">
            {history.total} receipt{history.total === 1 ? '' : 's'}
          </span>
        </Toolbar>

        <Panel className="overflow-hidden rounded-t-none">
          {/* Deliberately not "Payment History" — that exact string is the Client's own
              payments panel, which payment.spec.js anchors on by text. Two screens sharing a
              heading is how a text-based selector starts matching the wrong thing. */}
          <PanelHeader title="Completed Transactions" description="Receipts issued in this range" icon={History} />
          <PanelBody flush>
            <Table stack>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Receipt #</TableHead>
                  <TableHead>Patient Name</TableHead>
                  {/* The reference number moved under the payment method it belongs to. As its
                      own column it was empty on every cash row — which is most of them — so a
                      whole column of dashes was taking the width that made the receipt number
                      and the timestamp each wrap onto two lines. A GCash reference is a
                      property of the GCash payment, not a separate fact about the receipt. */}
                  <TableHead>Payment Method</TableHead>
                  <TableHead className="text-right">Amount Paid</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Date & Time</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.error ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-6 text-xs text-rose-600 font-semibold">
                      {history.error}{' '}
                      <button
                        type="button"
                        onClick={() => history.reload()}
                        className="underline font-bold border-0 bg-transparent cursor-pointer text-rose-700"
                      >
                        Retry
                      </button>
                    </TableCell>
                  </TableRow>
                ) : history.loading ? (
                  <SkeletonRows rows={6} columns={7} />
                ) : history.transactions.length > 0 ? (
                  history.transactions.map(t => (
                    <TableRow key={t.id}>
                      <TableCell label="Receipt #" className="whitespace-nowrap font-mono text-fine font-semibold text-slate-900">{t.receipt_number || `OR-${t.id}`}</TableCell>
                      <TableCell label="Patient" className="font-semibold text-slate-900">{t.patient_first_name} {t.patient_last_name}</TableCell>
                      <TableCell label="Method">
                        <Badge variant="outline" className="text-slate-600">{t.payment_method}</Badge>
                        {t.reference_number && (
                          <span className="mt-0.5 block font-mono text-fine text-slate-500">{t.reference_number}</span>
                        )}
                      </TableCell>
                      <TableCell
                        label="Amount"
                        className={`text-right font-semibold tabular-nums ${
                          (t.payment_status || 'Paid') === 'Paid'
                            ? 'text-emerald-700'
                            : 'text-slate-400 line-through'
                        }`}
                      >
                        {formatCurrency(t.amount)}
                      </TableCell>
                      <TableCell label="Status">
                        <StatusBadge status={t.payment_status || 'Paid'} />
                        {/* When it was reversed, and why. [1.30.0] The reason was required on
                            every reversal since [1.26.0] and then read back nowhere in the app —
                            written into the audit trail and invisible on the one screen where
                            somebody asks "what is this". The date is new: a reversal only got one
                            of its own in [1.30.0], and without it a row here cannot say whether
                            it belongs to this range's takings or only to its reversals. */}
                        {t.refunded_at && (
                          <span className="mt-1 block whitespace-nowrap text-fine font-semibold text-rose-600">
                            {formatDateTime(t.refunded_at)}
                          </span>
                        )}
                        {t.refund_reason && (
                          <span className="mt-0.5 block max-w-[24ch] text-fine text-slate-500">
                            {t.refund_reason}
                          </span>
                        )}
                      </TableCell>
                      <TableCell label="Paid at" className="whitespace-nowrap text-right text-fine text-slate-500">
                        {formatDateTime(t.paid_at)}
                        {/* The case the log could not represent before this range matched on
                            either date: taken on one day, reversed on another. Flagged because
                            the two readings of such a row are opposites — it is in this range's
                            reversals but not in its takings — and nothing else on the row says
                            so. */}
                        {isCrossDayReversal(t) && (
                          <span className="mt-0.5 block text-fine text-slate-400">
                            {t.counted_in_collected === false
                              ? 'taken earlier — not in this range'
                              : 'reversed on a later day'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button type="button" variant="outline" size="xs" onClick={() => receipt.reprint(t)}>
                            <Printer className="h-3 w-3" />
                            Reprint
                          </Button>
                          {(t.payment_status || 'Paid') === 'Paid' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => refund.request(t)}
                              className="text-rose-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                            >
                              <Undo2 className="h-3 w-3" />
                              Refund
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="p-0">
                      <EmptyState
                        icon={Receipt}
                        title="No payments in this date range"
                        description="Widen the dates above. Refunds and cancellations stay listed against their original receipt."
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </PanelBody>
          <Pagination
            page={history.page}
            totalPages={history.totalPages}
            onPageChange={(next) => history.goToPage(next)}
            total={history.total}
            pageSize={HISTORY_PAGE_SIZE}
          />
        </Panel>

        {/* Sales analysis, under the receipt log rather than on the till.
            The cashier had four figures — collected, cash, e-wallet, receipts — and no way to
            answer "which service is actually earning" or "how much did we give away in
            statutory discounts this week". These are the same panels the Admin roll-up shows,
            so a question asked upward is answered from the same numbers.

            Its own 7-day range, independent of the receipt list above: reconciling one day's
            drawer and seeing which services carry the week are different jobs. */}
        <div className="mt-4 space-y-4">
          <BillingTotalsPanel billing={operations.report?.billing} loading={operations.loading} />
          <SalesByServicePanel billing={operations.report?.billing} loading={operations.loading} limit={10} />
        </div>
      </div>
  );
}
