import React, { useState, useEffect, useCallback, useRef } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { usePolling } from '../hooks/usePolling';
import { Button } from '../components/ui/button';
import { Panel, PanelHeader, PanelBody } from '../components/ui/panel';
import PageHeader from '../components/ui/page-header';
import Toolbar, { ToolbarSpacer } from '../components/ui/toolbar';
import EmptyState from '../components/ui/empty-state';
import MetricCard from '../components/ui/metric-card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { SearchInput } from '../components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { StatusBadge } from '../components/ui/status-badge';
import WaitBadge from '../components/ui/wait-badge';
import { SkeletonList, SkeletonRows } from '../components/ui/skeleton';
import { Textarea } from '../components/ui/textarea';
import Pagination from '../components/ui/pagination';
import api from '../config/api';
import { todayStr, formatDateTime } from '../lib/date';
import { formatCurrency } from '../lib/currency';
import { toastError } from '../lib/toast';
import { useAuth } from '../contexts/AuthContext';
// Aliased: `Receipt` is already taken by the lucide icon used in this file's headers.
import ReceiptDocument from '../components/Receipt';
import useOperationsReport from '../hooks/useOperationsReport';
import { BillingTotalsPanel, SalesByServicePanel } from '../components/reports/OperationsPanels';
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

// Sent to the server as `limit` — Transaction History pages at the database now [1.29.0], rather
// than fetching the whole date range and slicing it here.
const HISTORY_PAGE_SIZE = 15;

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
  const [activeVisits, setActiveVisits] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  // Phase D finding 05: the billing queue, today's collections, and patient-type filter all
  // previously failed silently (console.error only) — the queue would just render empty with
  // no way to tell "no visits" apart from "the request failed."
  const [queueError, setQueueError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [sortOrder, setSortOrder] = useState('oldest');
  const [patientTypes, setPatientTypes] = useState([]);

  // Transaction History view state — deliberately separate from `transactions` above, which
  // stays pinned to *today* (it also drives paidVisitIds and the queue's collections metrics).
  // Reusing one state for both would mean picking a date range in History silently makes
  // "Today's Collections" stop meaning today.
  const [historyTransactions, setHistoryTransactions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyStartDate, setHistoryStartDate] = useState(todayStr());
  const [historyEndDate, setHistoryEndDate] = useState(todayStr());
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);

  // Feature Gap Plan Phase A: payment_status has always allowed 'Refunded'/'Cancelled', but
  // nothing in the app ever set them — a duplicate or disputed charge had no reversal path.
  const [refundTarget, setRefundTarget] = useState(null);
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState('');

  // Selected Billing Item in POS Layout
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [billDetails, setBillDetails] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [amountTendered, setAmountTendered] = useState('');
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  // The receipt modal gets its own copy of the bill rather than sharing `billDetails` with the
  // billing panel. Reprinting a past receipt used to overwrite `billDetails`, so returning to the
  // Billing Queue afterwards rendered the *checkout panel* from a history row — see
  // handleReprintReceipt below.
  const [receiptBill, setReceiptBill] = useState(null);
  // Monotonic id for bill fetches, so a slow response for a previously-selected patient cannot
  // overwrite the bill for the one the cashier is looking at now.
  const billRequestRef = useRef(0);
  // Statutory (Senior Citizen / PWD) and commercial discounts. The entitlement is stored against
  // the visit rather than held in the page, so the recalculated total comes back from the server
  // — the cashier must never be able to charge a figure the backend did not compute.
  const [discountCatalogue, setDiscountCatalogue] = useState([]);
  const [discountTypeId, setDiscountTypeId] = useState('');
  const [discountIdNumber, setDiscountIdNumber] = useState('');
  const [applyingDiscount, setApplyingDiscount] = useState(false);
  const [discountError, setDiscountError] = useState('');

  // Cash tendered and change are on the receipt now, and they only exist at the moment of
  // sale — a reprint has no record of what was handed over. null therefore means "this is a
  // reprint", which is also what stamps the duplicate copy.
  const [receiptTender, setReceiptTender] = useState(null);

  const [paymentError, setPaymentError] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState(null);
  const [showPaymentConfirm, setShowPaymentConfirm] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  const fetchActiveVisits = useCallback(async () => {
    try {
      const response = await api.get('/visits/active');
      setActiveVisits(response.data.data.visits || []);
      setQueueError('');
    } catch (err) {
      console.error('Failed to fetch active visits:', err);
      setQueueError('Could not load the billing queue. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      const response = await api.get('/payments/transactions');
      setTransactions(response.data.data.transactions || []);
    } catch (err) {
      console.error('Failed to fetch transaction logs:', err);
      setQueueError('Could not load today\'s collections. Please try again.');
    }
  }, []);

  const fetchPatientTypes = useCallback(async () => {
    try {
      const res = await api.get('/patients/types');
      setPatientTypes(res.data.data.patientTypes || []);
    } catch (err) {
      console.error('Failed to fetch patient types:', err);
    }
  }, []);

  const fetchDiscountCatalogue = useCallback(async () => {
    try {
      const res = await api.get('/discounts');
      setDiscountCatalogue(res.data.data.discounts || []);
    } catch (err) {
      console.error('Failed to fetch discount catalogue:', err);
    }
  }, []);

  /**
   * Re-reads the bill for the selected visit.
   *
   * Applying a discount changes the amount due, and that amount is recomputed server-side — the
   * cashier's screen must reflect what the backend will actually accept, since processPayment
   * rejects a submitted amount that disagrees by more than a centavo.
   */
  const refreshBill = useCallback(async (visitId) => {
    const response = await api.get(`/payments/bill/${visitId}`);
    const bill = response.data.data.bill;
    setBillDetails(bill);
    setAmountTendered((bill?.totalAmount ?? 0).toString());
    return bill;
  }, []);

  const handleApplyDiscount = async () => {
    if (!selectedVisit || !discountTypeId) return;
    setApplyingDiscount(true);
    setDiscountError('');
    try {
      await api.post(`/discounts/visit/${selectedVisit.id}`, {
        discountTypeId: parseInt(discountTypeId, 10),
        idNumber: discountIdNumber.trim(),
      });
      await refreshBill(selectedVisit.id);
      setDiscountTypeId('');
      setDiscountIdNumber('');
    } catch (err) {
      // Shown inline rather than as a toast: the commonest failure is a missing OSCA/PWD ID, and
      // the message needs to sit next to the field it is about.
      setDiscountError(err.response?.data?.message || 'Could not apply the discount.');
    } finally {
      setApplyingDiscount(false);
    }
  };

  const handleRemoveDiscount = async () => {
    if (!selectedVisit) return;
    setApplyingDiscount(true);
    setDiscountError('');
    try {
      await api.delete(`/discounts/visit/${selectedVisit.id}`);
      await refreshBill(selectedVisit.id);
    } catch (err) {
      setDiscountError(err.response?.data?.message || 'Could not remove the discount.');
    } finally {
      setApplyingDiscount(false);
    }
  };

  const retryQueueData = () => {
    fetchActiveVisits();
    fetchTransactions();
    fetchPatientTypes();
  };

  // Paged at the server. [1.29.0] This pulled every settled payment in the range and sliced
  // fifteen out of it here. Measured at 570 bytes a payment, a year-wide range is a 2.0 MB
  // response to fill a fifteen-row table — on the screen a cashier opens for the daily cash-up.
  const fetchTransactionHistory = useCallback(async (startDate, endDate, page = 1) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await api.get('/payments/transactions', {
        params: { startDate, endDate, page, limit: HISTORY_PAGE_SIZE },
      });
      const { transactions, total, totalPages } = response.data.data;
      setHistoryTransactions(transactions || []);
      setHistoryTotal(total ?? (transactions || []).length);
      setHistoryTotalPages(totalPages || 1);
      setHistoryPage(page);
    } catch (err) {
      console.error('Failed to fetch transaction history:', err);
      setHistoryError('Could not load transaction history. Please try again.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Phase D finding 03: Transaction History had no way to reopen a past receipt — the only
  // "Print Receipt" affordance was the modal shown immediately after processing a *new* payment.
  // Reuses that exact modal, just fed from a history row instead of a fresh processPayment response.
  // UI/UX Modernization Phase 10: previously reconstructed billDetails with only patientName, so
  // a reprinted receipt showed no itemized test breakdown even though the original one did —
  // fetches the same GET /payments/bill/:visitId the checkout panel already uses, keyed on the
  // transaction's own patient_visit_id, instead of hand-rolling a partial object.
  // Writes to `receiptBill`, never `billDetails`.
  //
  // It used to write `setBillDetails({ patientName })` — an object with no `items` array — into
  // the state that the *billing panel* also renders from. Two things went wrong with that. The
  // panel does `billDetails.items.map(...)` unguarded, so selecting a visit, reprinting a past
  // receipt, then returning to the Billing Queue threw a TypeError and (before the ErrorBoundary)
  // whited out the terminal. And more quietly: the panel would show one patient's name and totals
  // beside another patient's queue number, which is the state the wrong-amount charge came from.
  const handleReprintReceipt = async (transaction) => {
    setPaymentSuccess(transaction);
    setReceiptTender(null);
    setReceiptBill({
      patientName: `${transaction.patient_first_name} ${transaction.patient_last_name}`,
      items: [], // present from the start so the itemised block can never map over undefined
    });
    setShowReceiptModal(true);
    try {
      const response = await api.get(`/payments/bill/${transaction.patient_visit_id}`);
      setReceiptBill(response.data.data.bill);
    } catch (err) {
      console.error('Failed to load itemized bill for reprint:', err);
      toastError('Could not load the itemized test list for this receipt.');
    }
  };

  /**
   * Prints the receipt at 80mm rather than A4.
   *
   * The page size is chosen by a body class (see the @page rule in index.css) because @page
   * cannot be scoped to an element — it applies to the whole printed document. Set it, print,
   * take it off again, so printing a diagnostic report afterwards still gets a normal sheet.
   * The class is removed in a finally so an aborted print dialog cannot leave it stuck on.
   */
  const printReceipt = () => {
    document.body.classList.add('printing-receipt');
    try {
      window.print();
    } finally {
      document.body.classList.remove('printing-receipt');
    }
  };

  const handleOpenRefund = (transaction) => {
    setRefundTarget(transaction);
    setRefundReason('');
    setRefundError('');
  };

  const confirmRefund = async () => {
    if (!refundTarget) return;
    setRefundError('');

    if (refundReason.trim().length < 3) {
      setRefundError('A reason is required (at least 3 characters) — this becomes part of the audit trail.');
      return;
    }

    setRefunding(true);
    try {
      await api.patch(`/payments/${refundTarget.id}/status`, { status: 'Refunded', reason: refundReason.trim() });
      setRefundTarget(null);
      fetchTransactionHistory(historyStartDate, historyEndDate);
    } catch (err) {
      setRefundError(err.response?.data?.message || 'Failed to refund this payment.');
    } finally {
      setRefunding(false);
    }
  };

  useEffect(() => {
    fetchActiveVisits();
    fetchTransactions();
    fetchPatientTypes();
    fetchDiscountCatalogue();
  }, [fetchActiveVisits, fetchTransactions, fetchPatientTypes, fetchDiscountCatalogue]);

  // Keep the billing queue current: visits released by the front desk, and payments taken at a
  // second terminal, both used to be invisible here until the cashier changed a filter. Suspended
  // while a visit is selected for billing — refetching mid-checkout would rewrite the list under
  // the cashier's cursor, and `paidVisitIds` is derived from transactions, so a refresh could
  // pull the row they are actively charging out from under them.
  usePolling(
    () => {
      fetchActiveVisits();
      fetchTransactions();
    },
    30000,
    { enabled: view === 'cashier-queue' && !selectedVisit }
  );

  // Lazy-load Transaction History only once that tab is actually opened.
  useEffect(() => {
    if (view === 'cashier-history' && !historyLoaded) {
      setHistoryLoaded(true);
      fetchTransactionHistory(historyStartDate, historyEndDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // GET /visits/active returns both 'Pending' and 'Processing' visits (Processing = already
  // checked in, which includes visits already paid today) — cross-reference against today's
  // transactions so an already-paid visit can't be selected and billed a second time.
  const paidVisitIds = new Set(
    transactions.filter(t => t.payment_status === 'Paid').map(t => t.patient_visit_id)
  );

  const handleSelectVisitForBilling = async (visit) => {
    if (paidVisitIds.has(visit.id)) {
      toastError('This visit has already been paid today. Refresh the queue if this looks wrong.');
      return;
    }
    setSelectedVisit(visit);
    setPaymentError('');
    setPaymentSuccess(null);
    setReferenceNumber('');
    setAmountTendered('');

    // Clear the previous patient's bill before fetching the next one. Without this, a failed
    // fetch left the *previous* patient's totals on screen next to the newly selected patient's
    // queue number — and confirmProcessPayment posts `selectedVisit.id` with
    // `billDetails.totalAmount`, so the cashier would charge one patient another's amount. The
    // confirmation dialog quotes the stale name and figure too, so it reads as self-consistent
    // and gets confirmed.
    setBillDetails(null);
    // Clear the discount entry too: an OSCA number typed for one patient must never linger into
    // the next patient's bill.
    setDiscountTypeId('');
    setDiscountIdNumber('');
    setDiscountError('');

    // Guards against out-of-order responses: clicking patient A then B quickly can let A's slower
    // reply land last. Only the most recent selection is allowed to write state.
    const requestId = ++billRequestRef.current;

    try {
      const response = await api.get(`/payments/bill/${visit.id}`);
      if (requestId !== billRequestRef.current) return; // superseded by a later selection
      const bill = response.data.data.bill;
      setBillDetails(bill);
      setAmountTendered((bill?.totalAmount ?? 0).toString());
    } catch (err) {
      if (requestId !== billRequestRef.current) return;
      console.error(err);
      // Drop the selection as well as the bill. Leaving a selected visit with no bill is the
      // half-state that invited the mismatch above.
      setSelectedVisit(null);
      toastError('Failed to retrieve billing summary.');
    }
  };

  const handleProcessPayment = async (e) => {
    e.preventDefault();
    setPaymentError('');

    if (!selectedVisit || !billDetails) {
      setPaymentError('No active billing ticket selected.');
      return;
    }

    if (paidVisitIds.has(selectedVisit.id)) {
      setPaymentError('This visit was already paid — refresh the queue before retrying.');
      return;
    }

    const totalDue = parseFloat(billDetails.totalAmount);
    const tendered = parseFloat(amountTendered);

    if (paymentMethod === 'Cash' && (isNaN(tendered) || tendered < totalDue)) {
      setPaymentError(`Cash tendered (${formatCurrency(tendered || 0)}) is less than total amount due (${formatCurrency(totalDue)}).`);
      return;
    }

    if (paymentMethod !== 'Cash' && !referenceNumber) {
      setPaymentError(`Reference number is required for ${paymentMethod} transaction.`);
      return;
    }

    // Payment processing is irreversible (creates a receipt and advances the visit) —
    // require explicit confirmation before it fires. See .agents/skills/*/SKILL.md Phase 12.
    setShowPaymentConfirm(true);
  };

  const confirmProcessPayment = async () => {
    const totalDue = parseFloat(billDetails.totalAmount);
    setConfirmingPayment(true);
    setPaymentError('');

    try {
      const response = await api.post('/payments', {
        patientVisitId: selectedVisit.id,
        paymentMethod,
        referenceNumber: paymentMethod !== 'Cash' ? referenceNumber : null,
        amount: totalDue
      });

      const payment = response.data.data.payment;

      // The visit is advanced server-side, inside POST /payments itself. It used to be a
      // separate PATCH from here, which meant a network blip between the two requests left a
      // fully paid visit stuck at 'Pending' with its ticket never reaching a modality. A
      // walk-in is released the moment this returns; an appointment additionally needs its
      // front-desk check-in, and the backend handles that ordering either way.
      setShowPaymentConfirm(false);
      setPaymentSuccess(payment);
      setReceiptTender(
        paymentMethod === 'Cash'
          ? { tendered: parseFloat(amountTendered || 0), change: calculateChange() }
          : { tendered: null, change: null }
      );
      // Snapshot the bill for the receipt. The modal reads `receiptBill`, so it keeps showing
      // what was actually charged even once the panel moves on to the next patient.
      setReceiptBill(billDetails);
      setShowReceiptModal(true);
      fetchActiveVisits();
      fetchTransactions();
    } catch (err) {
      setPaymentError(err.response?.data?.message || 'Failed to process payment');
      setShowPaymentConfirm(false);
    } finally {
      setConfirmingPayment(false);
    }
  };

  const calculateChange = () => {
    if (!billDetails) return 0;
    const totalDue = parseFloat(billDetails.totalAmount);
    const tendered = parseFloat(amountTendered);
    if (isNaN(tendered) || tendered < totalDue) return 0;
    return tendered - totalDue;
  };

  // Metrics calculation
  const totalCollectionsToday = transactions.reduce((acc, t) => acc + parseFloat(t.amount || 0), 0);
  const cashTotal = transactions.filter(t => t.payment_method === 'Cash').reduce((acc, t) => acc + parseFloat(t.amount || 0), 0);
  const eWalletTotal = transactions.filter(t => t.payment_method === 'GCash' || t.payment_method === 'PayMaya').reduce((acc, t) => acc + parseFloat(t.amount || 0), 0);

  const filteredVisits = activeVisits
    .filter(v => {
      if (paidVisitIds.has(v.id)) return false;
      const matchesSearch = !searchQuery ||
        `${v.first_name} ${v.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (v.queue_number && v.queue_number.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesType = typeFilter === 'All' || v.patient_type_name === typeFilter;
      return matchesSearch && matchesType;
    })
    .sort((a, b) => {
      const diff = new Date(a.created_at) - new Date(b.created_at);
      return sortOrder === 'oldest' ? diff : -diff;
    });

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
        {queueError && (
          <div role="alert" className="alert alert-error">
            <AlertCircle />
            <span>{queueError}</span>
            <button type="button" onClick={retryQueueData} className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-bold text-rose-800 underline underline-offset-2">Retry</button>
          </div>
        )}

        {/* Collections Overview Metrics Bar */}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <MetricCard label="Collected Today" value={formatCurrency(totalCollectionsToday)} icon={DollarSign} tone="green" />
          <MetricCard label="Cash Collected" value={formatCurrency(cashTotal)} icon={Banknote} tone="emerald" />
          <MetricCard label="E-Wallet" value={formatCurrency(eWalletTotal)} caption="GCash + PayMaya" captionTone="slate" icon={Wallet} tone="indigo" />
          <MetricCard label="Receipts Issued" value={transactions.length} icon={Receipt} tone="slate" />
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
                    {filteredVisits.length} waiting
                  </Badge>
                }
              />

              {/* Filters sit in a sunken well rather than loose in the panel body, so the list
                  below reads as the panel's content and these read as controls over it. */}
              <div className="space-y-2 border-b border-[#e6ebf1] bg-slate-50/70 p-3">
                <SearchInput
                  placeholder="Search ticket # or name..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />

                <div className="flex items-center gap-2">
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="flex-1" aria-label="Filter the billing queue by patient type">
                      <SelectValue placeholder="Patient Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Types</SelectItem>
                      {patientTypes.map(t => (
                        <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSortOrder(o => (o === 'oldest' ? 'newest' : 'oldest'))}
                    title="Toggle sort order"
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    {sortOrder === 'oldest' ? 'Oldest first' : 'Newest first'}
                  </Button>
                </div>
              </div>

              <div className="max-h-[520px] space-y-2 overflow-y-auto p-3">
                {loading ? (
                  <SkeletonList rows={4} />
                ) : filteredVisits.length > 0 ? (
                  filteredVisits.map(visit => {
                    const isSelected = selectedVisit?.id === visit.id;
                    return (
                      // A button, not a div with onClick. This is how a cashier picks the visit
                      // they are about to take money for; it has to be reachable by keyboard and
                      // announce its selected state.
                      <button
                        key={visit.id}
                        type="button"
                        onClick={() => handleSelectVisitForBilling(visit)}
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
                    title={(searchQuery || typeFilter !== 'All') ? 'No tickets match this filter' : 'Nothing awaiting payment'}
                    description={(searchQuery || typeFilter !== 'All')
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
              {selectedVisit && billDetails ? (
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
                        {billDetails.patientName}
                      </h2>
                      <span className="text-fine text-slate-500">
                        Ticket {selectedVisit.queue_number} &bull; {selectedVisit.patient_type_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="block text-micro font-semibold uppercase tracking-[0.1em] text-slate-500">
                          Amount due
                        </span>
                        <span className="block text-xl font-extrabold leading-none tracking-tight tabular-nums text-slate-900">
                          {formatCurrency(billDetails.totalAmount)}
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
                          {/* `billDetails` is now only ever a complete bill or null, so this
                              cannot be partial the way it could when the reprint path wrote here.
                              The optional chain stays as a cheap guard at what was the crash
                              site, in case the endpoint's shape ever changes. */}
                          {(billDetails.items ?? []).map((item, idx) => (
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
                      <span className="font-bold text-slate-900">{formatCurrency(billDetails.subtotal)}</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600">
                      {/* Renamed: this line is HMO coverage only. It used to read "HMO Coverage /
                          Discount", which was the single occurrence of the word "discount" in the
                          entire app and described something that did not exist. */}
                      <span>HMO Coverage:</span>
                      <span className="font-bold text-emerald-600">- {formatCurrency(billDetails.hmoCoverage || 0)}</span>
                    </div>
                    {/* A statutory sale is VAT-EXEMPT, so the 12% comes off before the 20% does.
                        Shown as its own line because the patient is comparing what they pay to
                        the shelf price, and because BIR requires a VAT-exempt sale to be
                        presented this way rather than folded into one "discount" figure. */}
                    {parseFloat(billDetails.vatDeducted || 0) > 0 && (
                      <>
                        <div className="flex justify-between items-center text-gray-600">
                          <span>Less VAT (12%) — VAT-exempt sale:</span>
                          <span className="font-bold text-emerald-600">- {formatCurrency(billDetails.vatDeducted)}</span>
                        </div>
                        <div className="flex justify-between items-center text-gray-500 pt-1 border-t border-dashed border-gray-200">
                          <span className="text-fine uppercase tracking-wide font-bold">VAT-exempt sale</span>
                          <span className="text-fine font-bold text-slate-700">{formatCurrency(billDetails.vatExemptSale)}</span>
                        </div>
                      </>
                    )}
                    {/* Statutory deductions must be itemised on the receipt by name and rate, not
                        folded into the total — RA 9994 / RA 10754. */}
                    {billDetails.discount && (
                      <div className="flex justify-between items-center text-gray-600">
                        <span>
                          {billDetails.discount.name} ({parseFloat(billDetails.discount.percentage)}%)
                          {billDetails.discount.idNumber && (
                            <span className="text-meta text-gray-400 font-normal"> · ID {billDetails.discount.idNumber}</span>
                          )}
                        </span>
                        <span className="font-bold text-emerald-600">- {formatCurrency(billDetails.discountAmount || 0)}</span>
                      </div>
                    )}
                    <div className="pt-2 border-t border-gray-200 flex justify-between items-center text-sm font-extrabold text-slate-900">
                      <span>NET AMOUNT DUE:</span>
                      <span className="text-base text-brand-600">{formatCurrency(billDetails.totalAmount)}</span>
                    </div>
                  </div>

                  {/* Statutory discount control (Senior Citizen / PWD).
                      Deliberately sits between the bill and the payment form: the cashier checks
                      the ID against the person in front of them, and the total has to update
                      before any money is taken. */}
                  <div className="bg-white p-4 rounded-xl border border-gray-200/80 space-y-2.5">
                    <span className="field-label">Statutory / other discount</span>
                    {billDetails.discount ? (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs">
                          <BadgeCheck className="w-4 h-4 text-brand-600 flex-shrink-0" aria-hidden="true" />
                          <span className="font-bold text-slate-900">{billDetails.discount.name}</span>
                          <span className="text-gray-500">
                            {parseFloat(billDetails.discount.percentage)}%
                            {billDetails.discount.idNumber ? ` · ID ${billDetails.discount.idNumber}` : ''}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={applyingDiscount}
                          onClick={handleRemoveDiscount}
                        >
                          {applyingDiscount ? 'Removing…' : 'Remove'}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Select value={discountTypeId} onValueChange={setDiscountTypeId}>
                          <SelectTrigger className="text-xs sm:w-44" aria-label="Statutory or other discount"><SelectValue placeholder="No discount" /></SelectTrigger>
                          <SelectContent>
                            {discountCatalogue.map(d => (
                              <SelectItem key={d.id} value={String(d.id)}>
                                {d.name} ({parseFloat(d.percentage)}%)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={discountIdNumber}
                          onChange={(e) => setDiscountIdNumber(e.target.value)}
                          placeholder="OSCA / PWD ID number"
                          className="text-xs flex-1"
                          aria-label="Senior Citizen or PWD ID number"
                        />
                        <Button
                          type="button"
                          disabled={!discountTypeId || applyingDiscount}
                          onClick={handleApplyDiscount}
                          className="font-bold"
                        >
                          {applyingDiscount ? 'Applying…' : 'Apply'}
                        </Button>
                      </div>
                    )}
                    {discountError && (
                      <p role="alert" className="text-fine text-rose-600 font-semibold m-0">{discountError}</p>
                    )}
                  </div>

                  {/* Payment Processor Form */}
                  {/* id, because the Take Payment button lives in the pinned header above and
                      reaches this form by `form="checkout-form"`. */}
                  <form id="checkout-form" onSubmit={handleProcessPayment} className="space-y-4">
                    {paymentError && (
                      <div role="alert" className="alert alert-error">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{paymentError}</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="field-label">Payment method</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {['Cash', 'GCash', 'PayMaya', 'Bank'].map(method => (
                          <button
                            key={method}
                            type="button"
                            onClick={() => setPaymentMethod(method)}
                            className={`cursor-pointer rounded-lg border px-3 py-2 text-fine font-semibold transition-colors ${
                              paymentMethod === method
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
                    {billDetails?.patientType === 'HMO' && (
                      parseFloat(billDetails.hmoCoverage) > 0 ? (
                        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 flex items-center space-x-2 text-xs font-semibold">
                          <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                          <span>
                            <strong>HMO Partner Accredited</strong> — {formatCurrency(billDetails.hmoCoverage)} covered
                            {parseFloat(billDetails.hmoCoverage) >= parseFloat(billDetails.subtotal) ? ' (full coverage, ₱0.00 out of pocket).' : ' (partial coverage — remaining balance due).'}
                          </span>
                        </div>
                      ) : (billDetails.hmoPendingCount ?? 0) === 0 && (
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
                    {(billDetails?.hmoPendingCount ?? 0) > 0 && (
                      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 flex items-start space-x-2 text-xs">
                        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <span>
                          <strong>
                            {billDetails.hmoPendingCount} test{billDetails.hmoPendingCount > 1 ? 's' : ''} still
                            awaiting an HMO decision — {formatCurrency(billDetails.hmoPendingAmount)}
                          </strong>
                          <span className="block font-normal mt-0.5">
                            That amount is billed in full here. If the HMO approves it afterwards,
                            the patient has to come back for a refund.
                          </span>
                        </span>
                      </div>
                    )}

                    {paymentMethod === 'Cash' ? (
                      <div className="space-y-2 bg-white p-3 rounded-xl border border-gray-200">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label htmlFor="cashierdashboard-cash-tendered" className="field-label">Cash tendered</label>
                            <Input id="cashierdashboard-cash-tendered"
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              value={amountTendered}
                              onChange={e => setAmountTendered(e.target.value)}
                              className="text-sm font-bold"
                              required
                            />
                          </div>
                          <div className="space-y-1 bg-gray-50 p-2 rounded-lg border border-[#e6ebf1]">
                            <span className="field-label">Change Due</span>
                            <span className="text-base font-extrabold text-emerald-600">{formatCurrency(calculateChange())}</span>
                          </div>
                        </div>

                        {/* Quick Cash Presets */}
                        <div className="flex items-center space-x-1.5 pt-1">
                          <span className="text-meta font-extrabold text-slate-400 uppercase mr-1">Presets:</span>
                          {['100', '500', '1000'].map(val => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setAmountTendered(val)}
                              className="px-2 py-0.5 bg-slate-100 hover:bg-brand-500 hover:text-white rounded-md text-meta font-bold text-slate-700 transition-all border border-slate-200 cursor-pointer"
                            >
                              ₱{val}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setAmountTendered((billDetails?.totalAmount ?? 0).toString())}
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
                          placeholder={`Enter ${paymentMethod} reference code`}
                          value={referenceNumber}
                          onChange={e => setReferenceNumber(e.target.value)}
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
                    {filteredVisits.length > 0 && (
                      <p className="text-xs text-gray-400 m-0">
                        {filteredVisits.length} patient{filteredVisits.length === 1 ? '' : 's'} waiting to be billed.
                      </p>
                    )}
                  </div>

                  <div className="border-t border-[#e6ebf1] pt-5">
                    <span className="text-meta font-bold uppercase tracking-wider text-gray-500 block mb-3">
                      This shift so far
                    </span>
                    {/* "Receipts issued" used to be the left half of this pair, showing
                        `transactions.length` — the identical number to the Receipts Issued metric
                        card 400px above it, under an identical label. Six zeros on one screen and
                        two of them were the same zero. What replaces it is the figure the strip
                        above genuinely does not carry: how much was given away in statutory
                        discounts, which is the number a cashier reconciles against their senior
                        and PWD booklet at the end of a shift. */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-[#e6ebf1] bg-slate-50/80 p-3">
                        <span className="text-meta font-bold uppercase tracking-wider text-gray-500 block">Average per receipt</span>
                        <span className="text-lg font-extrabold text-slate-900 tabular-nums">
                          {transactions.length > 0
                            ? formatCurrency(
                                transactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0) / transactions.length
                              )
                            : formatCurrency(0)}
                        </span>
                      </div>
                      <div className="rounded-xl border border-[#e6ebf1] bg-slate-50/80 p-3">
                        <span className="text-meta font-bold uppercase tracking-wider text-gray-500 block">Statutory discounts</span>
                        <span className="text-lg font-extrabold text-slate-900 tabular-nums">
                          {formatCurrency(
                            transactions.reduce((sum, t) => sum + parseFloat(t.discount_amount || 0), 0)
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {transactions.length > 0 && (
                    <div>
                      <span className="text-meta font-bold uppercase tracking-wider text-gray-500 block mb-2">
                        Recent receipts
                      </span>
                      <div className="space-y-1.5">
                        {transactions.slice(0, 4).map((t) => (
                          <div
                            key={t.id}
                            className="flex items-center justify-between rounded-lg border border-[#e6ebf1] px-3 py-2"
                          >
                            <div className="min-w-0">
                              <span className="block text-xs font-bold text-slate-900 truncate">
                                {t.patient_first_name} {t.patient_last_name}
                              </span>
                              <span className="block text-meta text-gray-400 font-mono">#{t.receipt_number}</span>
                            </div>
                            <span className="text-xs font-extrabold text-slate-900 tabular-nums flex-shrink-0">
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
          // `historyTransactions` IS the page now — the server sent exactly these rows.
          const pagedHistoryTransactions = historyTransactions;
          return (
        <div>
          <Toolbar attached>
            <Input type="date" value={historyStartDate} onChange={e => setHistoryStartDate(e.target.value)} className="w-[150px]" aria-label="History start date" />
            <span className="text-fine text-slate-400">to</span>
            <Input type="date" value={historyEndDate} onChange={e => setHistoryEndDate(e.target.value)} className="w-[150px]" aria-label="History end date" />
            <Button variant="outline" onClick={() => fetchTransactionHistory(historyStartDate, historyEndDate)}>
              <RefreshCw className="h-3.5 w-3.5" />
              Apply
            </Button>
            <ToolbarSpacer />
            <span className="whitespace-nowrap text-fine font-medium tabular-nums text-slate-500">
              {historyTransactions.length} receipt{historyTransactions.length === 1 ? '' : 's'}
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
                  {historyError ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-6 text-xs text-rose-600 font-semibold">
                        {historyError}{' '}
                        <button
                          type="button"
                          onClick={() => fetchTransactionHistory(historyStartDate, historyEndDate)}
                          className="underline font-bold border-0 bg-transparent cursor-pointer text-rose-700"
                        >
                          Retry
                        </button>
                      </TableCell>
                    </TableRow>
                  ) : historyLoading ? (
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
                        <TableCell label="Amount" className="text-right font-semibold tabular-nums text-emerald-700">{formatCurrency(t.amount)}</TableCell>
                        <TableCell label="Status">
                          <StatusBadge status={t.payment_status || 'Paid'} />
                        </TableCell>
                        <TableCell label="Paid at" className="whitespace-nowrap text-right text-fine text-slate-500">{formatDateTime(t.paid_at)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button type="button" variant="outline" size="xs" onClick={() => handleReprintReceipt(t)}>
                              <Printer className="h-3 w-3" />
                              Reprint
                            </Button>
                            {(t.payment_status || 'Paid') === 'Paid' && (
                              <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                onClick={() => handleOpenRefund(t)}
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
              page={historyPage}
              totalPages={historyTotalPages}
              onPageChange={(next) => fetchTransactionHistory(historyStartDate, historyEndDate, next)}
              total={historyTotal}
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

        <Dialog open={!!refundTarget} onOpenChange={(open) => !refunding && !open && setRefundTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Refund Payment</DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                {refundTarget && `Refund ${formatCurrency(refundTarget.amount)} (Receipt ${refundTarget.receipt_number || `OR-${refundTarget.id}`})? This marks the payment as Refunded and cannot be undone from this screen.`}
              </DialogDescription>
            </DialogHeader>

            {refundError && (
              <div role="alert" className="alert alert-error">
                <AlertCircle />
                <span>{refundError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="cashierdashboard-reason" className="field-label">Reason <span className="text-red-600">*</span></label>
              <Textarea id="cashierdashboard-reason"
                value={refundReason}
                onChange={e => setRefundReason(e.target.value)}
                placeholder="e.g. Duplicate charge, patient dispute..."
                disabled={refunding}
                required
                className="text-xs rounded-xl"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRefundTarget(null)} disabled={refunding}>Cancel</Button>
              <Button
                type="button"
                onClick={confirmRefund}
                disabled={refunding}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {refunding ? 'Refunding…' : 'Confirm Refund'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Payment confirmation — irreversible action, see .agents Phase 12 */}
        <ConfirmDialog
          open={showPaymentConfirm}
          onOpenChange={setShowPaymentConfirm}
          title="Confirm Payment"
          description={billDetails ? `Charge ${formatCurrency(billDetails.totalAmount)} via ${paymentMethod} for ${billDetails.patientName}? This will issue a receipt and cannot be undone from this screen.` : ''}
          confirmLabel="Confirm & Process"
          onConfirm={confirmProcessPayment}
          loading={confirmingPayment}
          error={paymentError}
        />

        {/* Printable receipt. The document itself lives in components/Receipt.jsx so the point of
            sale and a later reprint cannot drift into showing different things. */}
        <Dialog open={showReceiptModal} onOpenChange={setShowReceiptModal}>
          <DialogContent className="max-w-sm">
            {paymentSuccess && receiptBill && (
              <>
                <ReceiptDocument
                  payment={paymentSuccess}
                  bill={receiptBill}
                  cashier={user ? `${user.firstName} ${user.lastName}` : undefined}
                  tendered={receiptTender?.tendered}
                  change={receiptTender?.change}
                  reprint={receiptTender == null}
                />
                {/* no-print: the print rule reveals every descendant of .print-area, so a toolbar
                    inside it comes out of the printer with the receipt. That is exactly what the
                    previous version did — the Print button printed itself. */}
                <div className="no-print flex justify-end gap-2 border-t border-[#e6ebf1] pt-3">
                  <Button variant="outline" onClick={() => setShowReceiptModal(false)}>
                    Close
                  </Button>
                  <Button onClick={printReceipt}>
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
