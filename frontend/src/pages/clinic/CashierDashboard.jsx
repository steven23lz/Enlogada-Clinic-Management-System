import React from 'react';
import SidebarLayout from '../../components/SidebarLayout';
import { Button } from '../../components/ui/button';
import { Panel, PanelHeader, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import Toolbar, { ToolbarSpacer } from '../../components/ui/toolbar';
import EmptyState from '../../components/ui/empty-state';
import MetricCard from '../../components/ui/metric-card';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { SearchInput } from '../../components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { StatusBadge } from '../../components/ui/status-badge';
import WaitBadge from '../../components/ui/wait-badge';
import { SkeletonList, SkeletonRows } from '../../components/ui/skeleton';
import { Textarea } from '../../components/ui/textarea';
import Pagination from '../../components/ui/pagination';
import { formatDateTime } from '../../lib/date';
import { formatCurrency } from '../../lib/currency';
import { useAuth } from '../../contexts/AuthContext';
// Aliased: `Receipt` is already taken by the lucide icon used in this file's headers.
import ReceiptDocument from '../../components/Receipt';
import useOperationsReport from '../../hooks/useOperationsReport';
import { BillingTotalsPanel, SalesByServicePanel } from '../../components/reports/OperationsPanels';
import { useTransactionHistory, HISTORY_PAGE_SIZE } from '../../hooks/useTransactionHistory';
import { useBillingQueue } from '../../hooks/useBillingQueue';
import { useRefund } from '../../hooks/useRefund';
import { useCheckout } from '../../hooks/useCheckout';
import { useReceipt } from '../../hooks/useReceipt';
import {
  Receipt,
  Wallet,
  Banknote,
  CheckCircle,
  Printer,
  DollarSign,
  AlertCircle,
  ArrowUpDown,
  RefreshCw,
  Undo2,
  BadgeCheck,
  History,
  Inbox
} from 'lucide-react';

const PAGE_TITLES = {
  'cashier-queue': 'Cashier POS & Billing Terminal',
  'cashier-history': 'Transaction History',
};

const PAGE_ICONS = {
  'cashier-queue': Receipt,
  'cashier-history': History,
};

const PAGE_BLURBS = {
  'cashier-queue': 'Select a patient from the billing queue to price their visit, apply a statutory discount, take payment and issue a receipt.',
  'cashier-history': 'Receipts you and other cashiers have issued, for the daily cash-up. Refunds and cancellations are recorded against the original receipt.',
};
const VALID_VIEWS = Object.keys(PAGE_TITLES);


const CashierDashboard = ({ activeNav = 'cashier-queue', onSelectNav }) => {
  // Any nav value this component doesn't recognize (e.g. a stale/default 'dashboard') falls
  // back to the primary billing queue view.
  const view = VALID_VIEWS.includes(activeNav) ? activeNav : 'cashier-queue';
  // Who is at the till. The receipt names them: a receipt nobody can be asked about is not much
  // use when a patient comes back three weeks later disputing a charge.
  const { user } = useAuth();
  // Sales analysis belongs on the History screen, not the till: a cashier mid-transaction does
  // not want a report, and a cashier doing the cash-up does. Only fetched when that view is open.
  const operations = useOperationsReport({ days: 7, enabled: view === 'cashier-history' });

  // Nine pieces of state, a fetch, a pagination handler and a lazy-load effect, behind one name.
  //
  // Deliberately separate from `queue.transactions` above, which stays pinned to *today* — it also
  // drives queue.paidVisitIds and the queue's collections metrics. Sharing one list between the two
  // would mean picking a date range in History silently changes what "Today's Collections" means.
  const history = useTransactionHistory({ enabled: view === 'cashier-history' });

  // Feature Gap Plan Phase A: payment_status has always allowed 'Refunded'/'Cancelled', but
  // nothing in the app ever set them — a duplicate or disputed charge had no reversal path.
  const refund = useRefund({ onRefunded: () => history.reload() });

  // The till, the queue and the receipt are three separate concerns and are wired to each other
  // here rather than inside one another. `checkout.selectedVisit` is read by the queue (to pause polling)
  // and the checkout announces a completed sale outward — nothing reaches back in.
  const receipt = useReceipt();

  const checkout = useCheckout({
    // A function, not `queue.paidVisitIds` — `queue` is declared below (it needs
    // `checkout.selectedVisit`), so reading a value here would hit the temporal dead zone.
    isAlreadyPaid: (visitId) => queue.paidVisitIds.has(visitId),
    // Everything that must happen only AFTER the money is taken. The checkout does not know a
    // receipt exists; it says a sale happened and the screen decides what that means.
    onPaid: ({ payment, bill, tender }) => {
      receipt.showForSale(payment, bill, tender);
      queue.refresh();
    },
  });

  // Declared after `checkout` because it reads it: polling is suspended while a visit is open
  // for billing, so a refetch cannot move the row out from under the cashier's cursor.
  const queue = useBillingQueue({
    enabled: view === 'cashier-queue',
    paused: Boolean(checkout.selectedVisit),
  });





  // Metrics calculation
  // Every peso figure on this screen comes from the endpoint's SQL summary, not from reducing
  // `queue.transactions`. That list is the receipt LOG and now includes receipts that were
  // reversed — summing it would put refunded money back into the day's collections, on the one
  // screen where the number has to match what is physically in the drawer.
  const totalCollectionsToday = Number(queue.summary?.collected || 0);
  const cashTotal = Number(queue.summary?.cash || 0);
  const eWalletTotal = Number(queue.summary?.ewallet || 0);
  const receiptsSettled = Number(queue.summary?.receipts || 0);
  const statutoryDiscounts = Number(queue.summary?.discounts || 0);
  const reversalCount = Number(queue.summary?.reversals || 0);
  const reversedAmount = Number(queue.summary?.reversed || 0);
  const bankTotal = Number(queue.summary?.bank || 0);
  const averagePerReceipt = receiptsSettled > 0 ? totalCollectionsToday / receiptsSettled : 0;


  return (
    <SidebarLayout title={PAGE_TITLES[view]} activeNav={view} onSelectNav={onSelectNav}>
      <div className="space-y-5">
        <PageHeader
          icon={PAGE_ICONS[view]}
          title={PAGE_TITLES[view]}
          description={PAGE_BLURBS[view]}
        />

        {view === 'cashier-queue' && (
        <>
        {queue.error && (
          <div role="alert" className="alert alert-error">
            <AlertCircle />
            <span>{queue.error}</span>
            <button type="button" onClick={queue.refresh} className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-bold text-rose-800 underline underline-offset-2">Retry</button>
          </div>
        )}

        {/* Collections Overview Metrics Bar */}
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

        {/* POS Split Workstation (Left: Billing Queue, Right: Invoice Checkout Terminal) */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">

          {/* Left Panel: Pending Patients Billing Queue */}
          <div className="lg:col-span-5">
            <Panel className="overflow-hidden">
              <PanelHeader
                title="Pending Billing Queue"
                icon={Receipt}
                actions={
                  <Badge variant="outline" className="border-brand-200 bg-brand-50 text-brand-700">
                    {queue.visits.length} waiting
                  </Badge>
                }
              />

              {/* Filters sit in a sunken well rather than loose in the panel body, so the list
                  below reads as the panel's content and these read as controls over it. */}
              <div className="space-y-2 border-b border-[#e6ebf1] bg-slate-50/70 p-3">
                <SearchInput
                  placeholder="Search ticket # or name..."
                  value={queue.searchQuery}
                  onChange={e => queue.setSearchQuery(e.target.value)}
                />

                <div className="flex items-center gap-2">
                  <Select value={queue.typeFilter} onValueChange={queue.setTypeFilter}>
                    <SelectTrigger className="flex-1" aria-label="Filter the billing queue by patient type">
                      <SelectValue placeholder="Patient Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Types</SelectItem>
                      {queue.patientTypes.map(t => (
                        <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => queue.setSortOrder(o => (o === 'oldest' ? 'newest' : 'oldest'))}
                    title="Toggle sort order"
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    {queue.sortOrder === 'oldest' ? 'Oldest first' : 'Newest first'}
                  </Button>
                </div>
              </div>

              <div className="max-h-[520px] space-y-2 overflow-y-auto p-3">
                {queue.loading ? (
                  <SkeletonList rows={4} />
                ) : queue.visits.length > 0 ? (
                  queue.visits.map(visit => {
                    const isSelected = checkout.selectedVisit?.id === visit.id;
                    return (
                      // A button, not a div with onClick. This is how a cashier picks the visit
                      // they are about to take money for; it has to be reachable by keyboard and
                      // announce its selected state.
                      <button
                        key={visit.id}
                        type="button"
                        onClick={() => checkout.select(visit)}
                        aria-pressed={isSelected}
                        className={`w-full cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                          isSelected
                            ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-400'
                            : 'border-[#e6ebf1] bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-semibold text-slate-900">{visit.first_name} {visit.last_name}</span>
                            <span className="block font-mono text-micro font-medium text-slate-400">{visit.queue_number || `V-${visit.id}`}</span>
                          </span>
                          <span className="flex flex-shrink-0 flex-col items-end gap-1">
                            <span className="flex items-center gap-1">
                              <Badge variant="outline" className={visit.visit_type === 'Walk in' ? 'text-slate-600' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}>
                                {visit.visit_type}
                              </Badge>
                              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                                {visit.patient_type_name || 'Self Pay'}
                              </Badge>
                            </span>
                            <WaitBadge since={visit.created_at} />
                          </span>
                        </span>
                        <span className="mt-2 flex items-center justify-between border-t border-[#eef2f6] pt-2 text-fine">
                          <span className="text-slate-500">{visit.tests?.length || 0} diagnostic item{visit.tests?.length === 1 ? '' : 's'}</span>
                          <span className={`font-semibold ${isSelected ? 'text-brand-700' : 'text-slate-400'}`}>
                            {isSelected ? 'Open in terminal' : 'Select for checkout →'}
                          </span>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  /* "Nothing awaiting payment" is false when seven people are waiting and the
                     search simply matched none of them — and it sends the cashier looking for
                     Reception instead of clearing their own filter. The two situations get
                     different words, as they do on every other queue in the app. */
                  <EmptyState
                    compact
                    icon={Inbox}
                    title={(queue.searchQuery || queue.typeFilter !== 'All') ? 'No tickets match this filter' : 'Nothing awaiting payment'}
                    description={(queue.searchQuery || queue.typeFilter !== 'All')
                      ? 'Clear the search or choose All Types to see the whole queue.'
                      : 'Visits appear here once Reception attaches tests to them.'}
                  />
                )}
              </div>
            </Panel>
          </div>

          {/* Right Panel: Invoice & Cashier POS Terminal */}
          <div className="lg:col-span-7">
            <Panel className="overflow-hidden">
              {checkout.selectedVisit && checkout.bill ? (
                <div>
                  {/* Who, how much, and the button — pinned to the top of the terminal.
                      ── Why the top and not the bottom ──────────────────────────────────────────
                      The primary action used to be the last element of a long column, which on a
                      900px screen put it 4px below the fold: completing a sale meant scrolling
                      past the bill to find the button, by which point the figure being charged
                      was off screen. The obvious fix — a sticky bar at the bottom — does not
                      work, and it is worth writing down why: a `position: sticky` element is
                      constrained by its containing block, and one that is already the LAST child
                      has no space beneath it to slide into, so it never moves. Measured at
                      y=904 against a 900px viewport before this changed.
                      A sticky header has no such problem, and for a till it is arguably better
                      anyway: the amount stays in front of the cashier the whole time they are
                      picking a method and counting cash, rather than reappearing at the end.
                      The button lives outside the form and reaches it by `form="checkout-form"`,
                      so submit behaviour and Enter-to-pay are unchanged. */}
                  <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-[#e6ebf1] bg-white/95 px-6 py-4 backdrop-blur-sm">
                    <div className="min-w-0">
                      <span className="field-label">Now billing</span>
                      <h2 className="m-0 truncate text-[15px] font-bold tracking-tight text-slate-900">
                        {checkout.bill.patientName}
                      </h2>
                      <span className="text-fine text-slate-500">
                        Ticket {checkout.selectedVisit.queue_number} &bull; {checkout.selectedVisit.patient_type_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="block text-micro font-semibold uppercase tracking-[0.1em] text-slate-500">
                          Amount due
                        </span>
                        <span className="block text-xl font-extrabold leading-none tracking-tight tabular-nums text-slate-900">
                          {formatCurrency(checkout.bill.totalAmount)}
                        </span>
                      </div>
                      <Button type="submit" form="checkout-form" size="lg">
                        <CheckCircle className="h-4 w-4" />
                        Take Payment
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-6 p-6">

                  {/* Itemized Tests Breakdown Table */}
                  <div className="space-y-2">
                    <span className="field-label">Itemised services</span>
                    <div className="border border-[#e6ebf1] rounded-xl overflow-hidden">
                      <Table>
                        <TableHeader sticky>
                          <TableRow>
                            <TableHead className="text-meta font-bold uppercase py-2">Test Name</TableHead>
                            <TableHead className="text-meta font-bold uppercase py-2">Category</TableHead>
                            <TableHead className="text-meta font-bold uppercase py-2 text-right">Price</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {/* `checkout.bill` is now only ever a complete bill or null, so this
                              cannot be partial the way it could when the reprint path wrote here.
                              The optional chain stays as a cheap guard at what was the crash
                              site, in case the endpoint's shape ever changes. */}
                          {(checkout.bill.items ?? []).map((item, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="py-2.5 text-xs font-bold text-slate-900">
                                {item.name}
                                {/* Why the HMO refused this one, on the line it applies to. The
                                    cashier is the person the patient asks, and until [1.27.0] the
                                    answer existed nowhere they could see — the charge simply
                                    appeared, higher than the patient had been led to expect. */}
                                {item.hmoRejected && item.hmoDecisionReason && (
                                  <span className="mt-0.5 block text-fine font-normal text-rose-700">
                                    HMO refused: {item.hmoDecisionReason}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="py-2.5 text-xs text-gray-500">{item.category}</TableCell>
                              <TableCell className="py-2.5 text-xs font-bold text-slate-900 text-right">{formatCurrency(item.price)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  {/* Subtotal & HMO Breakdown Card */}
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-200/80 space-y-2 text-xs">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>Gross Services Subtotal:</span>
                      <span className="font-bold text-slate-900">{formatCurrency(checkout.bill.subtotal)}</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600">
                      {/* Renamed: this line is HMO coverage only. It used to read "HMO Coverage /
                          Discount", which was the single occurrence of the word "discount" in the
                          entire app and described something that did not exist. */}
                      <span>HMO Coverage:</span>
                      <span className="font-bold text-emerald-600">- {formatCurrency(checkout.bill.hmoCoverage || 0)}</span>
                    </div>
                    {/* A statutory sale is VAT-EXEMPT, so the 12% comes off before the 20% does.
                        Shown as its own line because the patient is comparing what they pay to
                        the shelf price, and because BIR requires a VAT-exempt sale to be
                        presented this way rather than folded into one "discount" figure. */}
                    {parseFloat(checkout.bill.vatDeducted || 0) > 0 && (
                      <>
                        <div className="flex justify-between items-center text-gray-600">
                          <span>Less VAT (12%) — VAT-exempt sale:</span>
                          <span className="font-bold text-emerald-600">- {formatCurrency(checkout.bill.vatDeducted)}</span>
                        </div>
                        <div className="flex justify-between items-center text-gray-500 pt-1 border-t border-dashed border-gray-200">
                          <span className="text-fine uppercase tracking-wide font-bold">VAT-exempt sale</span>
                          <span className="text-fine font-bold text-slate-700">{formatCurrency(checkout.bill.vatExemptSale)}</span>
                        </div>
                      </>
                    )}
                    {/* Statutory deductions must be itemised on the receipt by name and rate, not
                        folded into the total — RA 9994 / RA 10754. */}
                    {checkout.bill.discount && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>
                          {checkout.bill.discount.name} ({parseFloat(checkout.bill.discount.percentage)}%)
                          {checkout.bill.discount.idNumber && (
                            <span className="text-meta text-gray-400 font-normal"> · ID {checkout.bill.discount.idNumber}</span>
                          )}
                        </span>
                        <span className="font-bold text-emerald-600">- {formatCurrency(checkout.bill.discountAmount || 0)}</span>
                      </div>
                    )}
                    <div className="pt-2 border-t border-gray-200 flex justify-between items-center text-sm font-extrabold text-slate-900">
                      <span>NET AMOUNT DUE:</span>
                      <span className="text-base text-brand-600">{formatCurrency(checkout.bill.totalAmount)}</span>
                    </div>
                  </div>

                  {/* Statutory discount control (Senior Citizen / PWD).
                      Deliberately sits between the bill and the payment form: the cashier checks
                      the ID against the person in front of them, and the total has to update
                      before any money is taken. */}
                  <div className="bg-white p-4 rounded-xl border border-gray-200/80 space-y-2.5">
                    <span className="field-label">Statutory / other discount</span>
                    {checkout.bill.discount ? (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs">
                          <BadgeCheck className="w-4 h-4 text-brand-600 flex-shrink-0" aria-hidden="true" />
                          <span className="font-bold text-slate-900">{checkout.bill.discount.name}</span>
                          <span className="text-gray-500">
                            {parseFloat(checkout.bill.discount.percentage)}%
                            {checkout.bill.discount.idNumber ? ` · ID ${checkout.bill.discount.idNumber}` : ''}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={checkout.applyingDiscount}
                          onClick={checkout.removeDiscount}
                        >
                          {checkout.applyingDiscount ? 'Removing…' : 'Remove'}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Select value={checkout.discountTypeId} onValueChange={checkout.setDiscountTypeId}>
                          <SelectTrigger className="text-xs sm:w-44" aria-label="Statutory or other discount"><SelectValue placeholder="No discount" /></SelectTrigger>
                          <SelectContent>
                            {checkout.discountCatalogue.map(d => (
                              <SelectItem key={d.id} value={String(d.id)}>
                                {d.name} ({parseFloat(d.percentage)}%)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={checkout.discountIdNumber}
                          onChange={(e) => checkout.setDiscountIdNumber(e.target.value)}
                          placeholder="OSCA / PWD ID number"
                          className="text-xs flex-1"
                          aria-label="Senior Citizen or PWD ID number"
                        />
                        <Button
                          type="button"
                          disabled={!checkout.discountTypeId || checkout.applyingDiscount}
                          onClick={checkout.applyDiscount}
                          className="font-bold"
                        >
                          {checkout.applyingDiscount ? 'Applying…' : 'Apply'}
                        </Button>
                      </div>
                    )}
                    {checkout.discountError && (
                      <p role="alert" className="text-fine text-rose-600 font-semibold m-0">{checkout.discountError}</p>
                    )}
                  </div>

                  {/* Payment Processor Form */}
                  {/* id, because the Take Payment button lives in the pinned header above and
                      reaches this form by `form="checkout-form"`. */}
                  <form id="checkout-form" onSubmit={checkout.requestConfirmation} className="space-y-4">
                    {checkout.error && (
                      <div role="alert" className="alert alert-error">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{checkout.error}</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="field-label">Payment method</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {['Cash', 'GCash', 'PayMaya', 'Bank'].map(method => (
                          <button
                            key={method}
                            type="button"
                            onClick={() => checkout.setPaymentMethod(method)}
                            className={`cursor-pointer rounded-lg border px-3 py-2 text-fine font-semibold transition-colors ${
                              checkout.paymentMethod === method
                                ? 'border-brand-500 bg-brand-500 text-white'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            {method}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Reflects the real, per-test-approved coverage computed server-side
                        (Module 14) — an HMO-category patient is not guaranteed full coverage
                        just from their billing category alone. */}
                    {checkout.bill?.patientType === 'HMO' && (
                      parseFloat(checkout.bill.hmoCoverage) > 0 ? (
                        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 flex items-center space-x-2 text-xs font-semibold">
                          <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                          <span>
                            <strong>HMO Partner Accredited</strong> — {formatCurrency(checkout.bill.hmoCoverage)} covered
                            {parseFloat(checkout.bill.hmoCoverage) >= parseFloat(checkout.bill.subtotal) ? ' (full coverage, ₱0.00 out of pocket).' : ' (partial coverage — remaining balance due).'}
                          </span>
                        </div>
                      ) : (checkout.bill.hmoPendingCount ?? 0) === 0 && (
                        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 flex items-center space-x-2 text-xs font-semibold">
                          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                          <span><strong>HMO Partner Accredited</strong> — no approved coverage yet for this visit. Full amount is due unless Reception logs an approval first.</span>
                        </div>
                      )
                    )}

                    {/* A claim nobody has answered yet. [1.27.0] Shown whatever the patient type
                        and whatever the coverage so far, because partial coverage is exactly the
                        case the green badge above used to swallow: some tests approved, others
                        still open, and the amount at stake invisible.

                        It names the figure rather than saying "some tests", because the decision
                        the cashier is making is whether that number is small enough to collect now
                        and refund later, or large enough to be worth chasing the provider first.
                        Not a block — some providers take days, and the patient cannot wait at the
                        counter for one. */}
                    {(checkout.bill?.hmoPendingCount ?? 0) > 0 && (
                      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 flex items-start space-x-2 text-xs">
                        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <span>
                          <strong>
                            {checkout.bill.hmoPendingCount} test{checkout.bill.hmoPendingCount > 1 ? 's' : ''} still
                            awaiting an HMO decision — {formatCurrency(checkout.bill.hmoPendingAmount)}
                          </strong>
                          <span className="block font-normal mt-0.5">
                            That amount is billed in full here. If the HMO approves it afterwards,
                            the patient has to come back for a refund.
                          </span>
                        </span>
                      </div>
                    )}

                    {checkout.paymentMethod === 'Cash' ? (
                      <div className="space-y-2 bg-white p-3 rounded-xl border border-gray-200">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label htmlFor="cashierdashboard-cash-tendered" className="field-label">Cash tendered</label>
                            <Input id="cashierdashboard-cash-tendered"
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              value={checkout.amountTendered}
                              onChange={e => checkout.setAmountTendered(e.target.value)}
                              className="text-sm font-bold"
                              required
                            />
                          </div>
                          <div className="space-y-1 bg-gray-50 p-2 rounded-lg border border-[#e6ebf1]">
                            <span className="field-label">Change Due</span>
                            <span className="text-base font-extrabold text-emerald-600">{formatCurrency(checkout.changeDue())}</span>
                          </div>
                        </div>

                        {/* Quick Cash Presets */}
                        <div className="flex items-center space-x-1.5 pt-1">
                          <span className="text-meta font-extrabold text-slate-400 uppercase mr-1">Presets:</span>
                          {['100', '500', '1000'].map(val => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => checkout.setAmountTendered(val)}
                              className="px-2 py-0.5 bg-slate-100 hover:bg-brand-500 hover:text-white rounded-md text-meta font-bold text-slate-700 transition-all border border-slate-200 cursor-pointer"
                            >
                              ₱{val}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => checkout.setAmountTendered((checkout.bill?.totalAmount ?? 0).toString())}
                            className="px-2 py-0.5 bg-brand-50 text-brand-600 hover:bg-brand-500 hover:text-white rounded-md text-meta font-bold transition-all border border-brand-300 cursor-pointer"
                          >
                            Exact
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <label htmlFor="cashierdashboard-transaction-reference" className="field-label">Transaction reference</label>
                        <Input id="cashierdashboard-transaction-reference"
                          placeholder={`Enter ${checkout.paymentMethod} reference code`}
                          value={checkout.referenceNumber}
                          onChange={e => checkout.setReferenceNumber(e.target.value)}
                          className="text-xs rounded-xl"
                          required
                        />
                      </div>
                    )}

                  </form>
                  </div>
                </div>
              ) : (
                /* Idle state. This panel is the largest area on the busiest screen in the clinic
                   and it previously held one grey sentence, so for most of a shift the cashier's
                   main view was mostly empty. The prompt still leads, because it is the answer to
                   "what do I do", but the space beneath it now carries the shift summary a cashier
                   would otherwise go to Transaction History to find. */
                <div className="p-8 space-y-6">
                  <div className="text-center space-y-2">
                    <Receipt className="w-10 h-10 text-gray-300 mx-auto" />
                    <p className="text-sm font-bold text-gray-500 m-0">
                      Select a patient ticket from the queue to open the billing terminal.
                    </p>
                    {queue.visits.length > 0 && (
                      <p className="text-xs text-gray-400 m-0">
                        {queue.visits.length} patient{queue.visits.length === 1 ? '' : 's'} waiting to be billed.
                      </p>
                    )}
                  </div>

                  <div className="border-t border-[#e6ebf1] pt-5">
                    <span className="text-meta font-bold uppercase tracking-wider text-gray-500 block mb-3">
                      This shift so far
                    </span>
                    {/* "Receipts issued" used to be the left half of this pair, showing
                        `queue.transactions.length` — the identical number to the Receipts Issued metric
                        card 400px above it, under an identical label. Six zeros on one screen and
                        two of them were the same zero. What replaces it is the figure the strip
                        above genuinely does not carry: how much was given away in statutory
                        discounts, which is the number a cashier reconciles against their senior
                        and PWD booklet at the end of a shift. */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-[#e6ebf1] bg-slate-50/80 p-3">
                        <span className="text-meta font-bold uppercase tracking-wider text-gray-500 block">Average per receipt</span>
                        <span className="text-lg font-extrabold text-slate-900 tabular-nums">
                          {formatCurrency(averagePerReceipt)}
                        </span>
                      </div>
                      <div className="rounded-xl border border-[#e6ebf1] bg-slate-50/80 p-3">
                        <span className="text-meta font-bold uppercase tracking-wider text-gray-500 block">Statutory discounts</span>
                        <span className="text-lg font-extrabold text-slate-900 tabular-nums">
                          {formatCurrency(statutoryDiscounts)}
                        </span>
                      </div>
                    </div>
                    {/* Only when there is one. A permanent "0 reversed" row would be noise on the
                        overwhelming majority of shifts; on the shift where it is not zero, it is
                        the reason the drawer will not balance. */}
                    {reversalCount > 0 && (
                      <div className="mt-3 flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2">
                        <span className="text-meta font-bold uppercase tracking-wider text-rose-700">
                          Reversed this shift
                        </span>
                        <span className="text-sm font-extrabold tabular-nums text-rose-700">
                          {formatCurrency(reversedAmount)}
                          <span className="ml-1.5 font-semibold text-rose-500">
                            ({reversalCount} receipt{reversalCount === 1 ? '' : 's'})
                          </span>
                        </span>
                      </div>
                    )}
                  </div>

                  {queue.transactions.length > 0 && (
                    <div>
                      <span className="text-meta font-bold uppercase tracking-wider text-gray-500 block mb-2">
                        Recent receipts
                      </span>
                      <div className="space-y-1.5">
                        {queue.transactions.slice(0, 4).map((t) => (
                          <div
                            key={t.id}
                            className="flex items-center justify-between rounded-lg border border-[#e6ebf1] px-3 py-2"
                          >
                            <div className="min-w-0">
                              <span className="block text-xs font-bold text-slate-900 truncate">
                                {t.patient_first_name} {t.patient_last_name}
                              </span>
                              <span className="block text-meta text-gray-400 font-mono">
                                #{t.receipt_number}
                                {/* Named, not merely struck. This list is glanceable — four lines
                                    a cashier reads sideways — and a reversed receipt sitting in it
                                    unlabelled reads as money taken. */}
                                {(t.payment_status || 'Paid') !== 'Paid' && (
                                  <span className="ml-1.5 font-sans font-bold uppercase tracking-wide text-rose-600">
                                    {t.payment_status}
                                  </span>
                                )}
                              </span>
                            </div>
                            <span className={`text-xs font-extrabold tabular-nums flex-shrink-0 ${
                              (t.payment_status || 'Paid') === 'Paid'
                                ? 'text-slate-900'
                                : 'text-slate-400 line-through'
                            }`}>
                              {formatCurrency(parseFloat(t.amount || 0))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Panel>
          </div>

        </div>
        </>
        )}

        {view === 'cashier-history' && (() => {
          // `history.transactions` IS the page now — the server sent exactly these rows.
          const pagedHistoryTransactions = history.transactions;
          return (
        <div>
          <Toolbar attached>
            <Input type="date" value={history.startDate} onChange={e => history.setStartDate(e.target.value)} className="w-[150px]" aria-label="History start date" />
            <span className="text-fine text-slate-400">to</span>
            <Input type="date" value={history.endDate} onChange={e => history.setEndDate(e.target.value)} className="w-[150px]" aria-label="History end date" />
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
                  ) : pagedHistoryTransactions.length > 0 ? (
                    pagedHistoryTransactions.map(t => (
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
                        </TableCell>
                        <TableCell label="Paid at" className="whitespace-nowrap text-right text-fine text-slate-500">{formatDateTime(t.paid_at)}</TableCell>
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
        })()}

        <Dialog open={!!refund.target} onOpenChange={(open) => { if (!open) refund.cancel(); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Refund Payment</DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                {refund.target && `Refund ${formatCurrency(refund.target.amount)} (Receipt ${refund.target.receipt_number || `OR-${refund.target.id}`})? This marks the payment as Refunded and cannot be undone from this screen.`}
              </DialogDescription>
            </DialogHeader>

            {refund.error && (
              <div role="alert" className="alert alert-error">
                <AlertCircle />
                <span>{refund.error}</span>
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="cashierdashboard-reason" className="field-label">Reason <span className="text-red-600">*</span></label>
              <Textarea id="cashierdashboard-reason"
                value={refund.reason}
                onChange={e => refund.setReason(e.target.value)}
                placeholder="e.g. Duplicate charge, patient dispute..."
                disabled={refund.submitting}
                required
                className="text-xs rounded-xl"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={refund.cancel} disabled={refund.submitting}>Cancel</Button>
              <Button
                type="button"
                onClick={refund.confirm}
                disabled={refund.submitting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {refund.submitting ? 'Refunding…' : 'Confirm Refund'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Payment confirmation — irreversible action, see .agents Phase 12 */}
        <ConfirmDialog
          open={checkout.confirming}
          onOpenChange={(next) => { if (!next) checkout.cancelConfirmation(); }}
          title="Confirm Payment"
          description={checkout.bill ? `Charge ${formatCurrency(checkout.bill.totalAmount)} via ${checkout.paymentMethod} for ${checkout.bill.patientName}? This will issue a receipt and cannot be undone from this screen.` : ''}
          confirmLabel="Confirm & Process"
          onConfirm={checkout.confirm}
          loading={checkout.submitting}
          error={checkout.error}
        />

        {/* Printable receipt. The document itself lives in components/Receipt.jsx so the point of
            sale and a later reprint cannot drift into showing different things. */}
        <Dialog open={receipt.open} onOpenChange={receipt.setOpen}>
          <DialogContent className="max-w-sm">
            {receipt.payment && receipt.bill && (
              <>
                <ReceiptDocument
                  payment={receipt.payment}
                  bill={receipt.bill}
                  cashier={user ? `${user.firstName} ${user.lastName}` : undefined}
                  tendered={receipt.tender?.tendered}
                  change={receipt.tender?.change}
                  reprint={receipt.tender == null}
                />
                {/* no-print: the print rule reveals every descendant of .print-area, so a toolbar
                    inside it comes out of the printer with the receipt. That is exactly what the
                    previous version did — the Print button printed itself. */}
                <div className="no-print flex justify-end gap-2 border-t border-[#e6ebf1] pt-3">
                  <Button variant="outline" onClick={() => receipt.setOpen(false)}>
                    Close
                  </Button>
                  <Button onClick={receipt.print}>
                    <Printer className="h-3.5 w-3.5" />
                    Print Receipt
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

      </div>
    </SidebarLayout>
  );
};

export default CashierDashboard;
