import React, { useState, useEffect, useCallback } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
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
import { formatCurrency } from '../lib/currency';
import { toastError } from '../lib/toast';
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
  Undo2
} from 'lucide-react';

const PAGE_TITLES = {
  'cashier-queue': 'Cashier POS & Billing Terminal',
  'cashier-history': 'Transaction History',
};
const VALID_VIEWS = Object.keys(PAGE_TITLES);
const todayStr = () => new Date().toISOString().slice(0, 10);

// UI/UX Modernization Phase 4: Transaction History has no server-side pagination endpoint, so a
// client-side page size over the already-fetched, date-range-filtered array is proportionate —
// same pattern as StaffAccounts.jsx (VISUAL_IDENTITY.md §3a #11).
const HISTORY_PAGE_SIZE = 15;

const CashierDashboard = ({ activeNav = 'cashier-queue', onSelectNav }) => {
  // Any nav value this component doesn't recognize (e.g. a stale/default 'dashboard') falls
  // back to the primary billing queue view.
  const view = VALID_VIEWS.includes(activeNav) ? activeNav : 'cashier-queue';
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

  const retryQueueData = () => {
    fetchActiveVisits();
    fetchTransactions();
    fetchPatientTypes();
  };

  const fetchTransactionHistory = useCallback(async (startDate, endDate) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await api.get('/payments/transactions', { params: { startDate, endDate } });
      setHistoryTransactions(response.data.data.transactions || []);
      setHistoryPage(1);
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
  const handleReprintReceipt = async (transaction) => {
    setPaymentSuccess(transaction);
    setBillDetails({ patientName: `${transaction.patient_first_name} ${transaction.patient_last_name}` });
    setShowReceiptModal(true);
    try {
      const response = await api.get(`/payments/bill/${transaction.patient_visit_id}`);
      setBillDetails(response.data.data.bill);
    } catch (err) {
      console.error('Failed to load itemized bill for reprint:', err);
      toastError('Could not load the itemized test list for this receipt.');
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
  }, [fetchActiveVisits, fetchTransactions, fetchPatientTypes]);

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

    try {
      const response = await api.get(`/payments/bill/${visit.id}`);
      const bill = response.data.data.bill;
      setBillDetails(bill);
      setAmountTendered((bill?.totalAmount ?? 0).toString());
    } catch (err) {
      console.error(err);
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
      <div className="space-y-6">

        {view === 'cashier-queue' && (
        <>
        {queueError && (
          <div role="alert" className="p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-semibold rounded-xl flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{queueError}</span>
            <button type="button" onClick={retryQueueData} className="underline font-bold border-0 bg-transparent cursor-pointer text-rose-800">Retry</button>
          </div>
        )}

        {/* Collections Overview Metrics Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Today's Collections" value={formatCurrency(totalCollectionsToday)} icon={DollarSign} tone="green" />
          <MetricCard label="Cash Collected" value={formatCurrency(cashTotal)} icon={Banknote} tone="emerald" />
          <MetricCard label="E-Wallet (GCash/PayMaya)" value={formatCurrency(eWalletTotal)} icon={Wallet} tone="indigo" />
          <MetricCard label="Receipts Processed" value={transactions.length} icon={Receipt} tone="slate" />
        </div>

        {/* POS Split Workstation (Left: Billing Queue, Right: Invoice Checkout Terminal) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* Left Panel: Pending Patients Billing Queue */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 m-0 flex items-center space-x-2">
                  <Receipt className="w-4 h-4 text-[#769046]" />
                  <span>Pending Billing Queue</span>
                </h3>
                <Badge variant="secondary" className="bg-[#769046]/10 text-[#769046] font-bold">
                  {filteredVisits.length} Pending
                </Badge>
              </div>

              <SearchInput
                placeholder="Search ticket # or name..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />

              <div className="flex items-center gap-2">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="flex-1 text-xs rounded-xl">
                    <SelectValue placeholder="Patient Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Types</SelectItem>
                    {patientTypes.map(t => (
                      <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => setSortOrder(o => (o === 'oldest' ? 'newest' : 'oldest'))}
                  title="Toggle sort order"
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-[11px] font-bold text-gray-600 hover:bg-gray-100 cursor-pointer transition-colors whitespace-nowrap"
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span>{sortOrder === 'oldest' ? 'Oldest First' : 'Newest First'}</span>
                </button>
              </div>

              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {loading ? (
                  <SkeletonList rows={4} />
                ) : filteredVisits.length > 0 ? (
                  filteredVisits.map(visit => {
                    const isSelected = selectedVisit?.id === visit.id;
                    return (
                      <div
                        key={visit.id}
                        onClick={() => handleSelectVisitForBilling(visit)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#769046]/10 border-[#769046] shadow-sm'
                            : 'bg-gray-50/70 border-gray-100 hover:bg-gray-50 hover:border-gray-200'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-extrabold text-xs text-slate-900">{visit.first_name} {visit.last_name}</span>
                            <span className="block text-[10px] text-gray-400 font-bold uppercase">Ticket: {visit.queue_number || `V-${visit.id}`}</span>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-1">
                              <Badge
                                className={`text-[10px] font-bold ${
                                  visit.visit_type === 'Walk in' ? 'bg-slate-100 text-slate-700' : 'bg-indigo-100 text-indigo-700'
                                }`}
                              >
                                {visit.visit_type}
                              </Badge>
                              <Badge className="bg-amber-100 text-amber-800 text-[10px] font-bold">
                                {visit.patient_type_name || 'Self Pay'}
                              </Badge>
                            </div>
                            <WaitBadge since={visit.created_at} />
                          </div>
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between items-center text-[11px]">
                          <span className="text-gray-500">{visit.tests?.length || 0} diagnostic item(s)</span>
                          <span className="font-bold text-[#769046]">Select for Checkout &rarr;</span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-xs text-gray-400 font-semibold italic">
                    No pending patients awaiting billing checkout.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel: Invoice & Cashier POS Terminal */}
          <div className="lg:col-span-7 space-y-4">
            <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-6">
              {selectedVisit && billDetails ? (
                <div className="space-y-6">
                  
                  {/* Header Patient Summary */}
                  <div className="border-b border-gray-100 pb-4 flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Official Billing Terminal</span>
                      <h2 className="text-lg font-bold text-slate-900 m-0">{billDetails.patientName}</h2>
                      <span className="text-xs text-gray-500">Ticket #: {selectedVisit.queue_number} &bull; Type: {selectedVisit.patient_type_name}</span>
                    </div>
                    <Badge className="bg-[#769046] text-white font-extrabold px-3 py-1 text-xs">
                      READY FOR PAYMENT
                    </Badge>
                  </div>

                  {/* Itemized Tests Breakdown Table */}
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Itemized Clinical Services</span>
                    <div className="border border-gray-100 rounded-xl overflow-hidden">
                      <Table>
                        <TableHeader className="bg-gray-50/80">
                          <TableRow>
                            <TableHead className="text-[10px] font-bold uppercase py-2">Test Name</TableHead>
                            <TableHead className="text-[10px] font-bold uppercase py-2">Category</TableHead>
                            <TableHead className="text-[10px] font-bold uppercase py-2 text-right">Price</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {billDetails.items.map((item, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="py-2.5 text-xs font-bold text-slate-900">{item.name}</TableCell>
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
                      <span>HMO Coverage / Discount:</span>
                      <span className="font-bold text-emerald-600">- {formatCurrency(billDetails.hmoCoverage || 0)}</span>
                    </div>
                    <div className="pt-2 border-t border-gray-200 flex justify-between items-center text-sm font-extrabold text-slate-900">
                      <span>NET AMOUNT DUE:</span>
                      <span className="text-base text-[#769046]">{formatCurrency(billDetails.totalAmount)}</span>
                    </div>
                  </div>

                  {/* Payment Processor Form */}
                  <form onSubmit={handleProcessPayment} className="space-y-4">
                    {paymentError && (
                      <div role="alert" className="p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-bold rounded-xl flex items-center space-x-2">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{paymentError}</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-600 uppercase block">Select Payment Method</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {['Cash', 'GCash', 'PayMaya', 'Bank'].map(method => (
                          <button
                            key={method}
                            type="button"
                            onClick={() => setPaymentMethod(method)}
                            className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                              paymentMethod === method
                                ? 'bg-[#769046] text-white border-[#769046] shadow-sm'
                                : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
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
                      ) : (
                        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 flex items-center space-x-2 text-xs font-semibold">
                          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                          <span><strong>HMO Partner Accredited</strong> — no approved coverage yet for this visit. Full amount is due unless Reception logs an approval first.</span>
                        </div>
                      )
                    )}

                    {paymentMethod === 'Cash' ? (
                      <div className="space-y-2 bg-white p-3 rounded-xl border border-gray-200">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase">Cash Tendered (₱)</label>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              value={amountTendered}
                              onChange={e => setAmountTendered(e.target.value)}
                              className="text-sm font-bold"
                              required
                            />
                          </div>
                          <div className="space-y-1 bg-gray-50 p-2 rounded-lg border border-gray-100">
                            <span className="text-[10px] font-bold text-gray-400 uppercase block">Change Due</span>
                            <span className="text-base font-extrabold text-emerald-600">{formatCurrency(calculateChange())}</span>
                          </div>
                        </div>

                        {/* Quick Cash Presets */}
                        <div className="flex items-center space-x-1.5 pt-1">
                          <span className="text-[10px] font-extrabold text-slate-400 uppercase mr-1">Presets:</span>
                          {['100', '500', '1000'].map(val => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setAmountTendered(val)}
                              className="px-2 py-0.5 bg-slate-100 hover:bg-[#769046] hover:text-white rounded-md text-[10px] font-bold text-slate-700 transition-all border border-slate-200 cursor-pointer"
                            >
                              ₱{val}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setAmountTendered((billDetails?.totalAmount ?? 0).toString())}
                            className="px-2 py-0.5 bg-[#769046]/10 text-[#769046] hover:bg-[#769046] hover:text-white rounded-md text-[10px] font-bold transition-all border border-[#769046]/30 cursor-pointer"
                          >
                            Exact
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-600 uppercase">Transaction Reference / Ref Number</label>
                        <Input
                          placeholder={`Enter ${paymentMethod} reference code`}
                          value={referenceNumber}
                          onChange={e => setReferenceNumber(e.target.value)}
                          className="text-xs rounded-xl"
                          required
                        />
                      </div>
                    )}

                    <Button
                      type="submit"
                      className="w-full bg-[#769046] hover:bg-[#657c3a] text-white font-extrabold text-sm py-3 rounded-xl shadow-md cursor-pointer transition-all"
                    >
                      Process Checkout Payment & Issue Official Receipt
                    </Button>
                  </form>

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

                  <div className="border-t border-gray-100 pt-5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-3">
                      This shift so far
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">Receipts issued</span>
                        <span className="text-lg font-extrabold text-slate-900 tabular-nums">{transactions.length}</span>
                      </div>
                      <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block">Average per receipt</span>
                        <span className="text-lg font-extrabold text-slate-900 tabular-nums">
                          {transactions.length > 0
                            ? formatCurrency(
                                transactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0) / transactions.length
                              )
                            : formatCurrency(0)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {transactions.length > 0 && (
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-2">
                        Recent receipts
                      </span>
                      <div className="space-y-1.5">
                        {transactions.slice(0, 4).map((t) => (
                          <div
                            key={t.id}
                            className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <span className="block text-xs font-bold text-slate-900 truncate">
                                {t.patient_first_name} {t.patient_last_name}
                              </span>
                              <span className="block text-[10px] text-gray-400 font-mono">#{t.receipt_number}</span>
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
            </Card>
          </div>

        </div>
        </>
        )}

        {view === 'cashier-history' && (() => {
          const historyTotalPages = Math.max(1, Math.ceil(historyTransactions.length / HISTORY_PAGE_SIZE));
          const pagedHistoryTransactions = historyTransactions.slice(
            (historyPage - 1) * HISTORY_PAGE_SIZE,
            historyPage * HISTORY_PAGE_SIZE
          );
          return (
        <div className="space-y-6">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-100 shadow-xs">
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900 m-0">Transaction History</h3>
              <p className="text-xs text-gray-500 m-0">Receipts processed within the selected date range.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={historyStartDate} onChange={e => setHistoryStartDate(e.target.value)} className="text-xs w-36" />
              <span className="text-xs text-gray-400">to</span>
              <Input type="date" value={historyEndDate} onChange={e => setHistoryEndDate(e.target.value)} className="text-xs w-36" />
              <Button
                variant="outline"
                onClick={() => fetchTransactionHistory(historyStartDate, historyEndDate)}
                className="flex items-center space-x-1.5 text-xs font-semibold"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Apply</span>
              </Button>
            </div>
          </div>

          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 m-0">Completed Cashier Transactions</h3>
              <Badge variant="secondary" className="bg-[#769046]/10 text-[#769046] font-bold">
                {historyTransactions.length} Receipt(s)
              </Badge>
            </div>

            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <Table>
                <TableHeader className="bg-gray-50/80">
                  <TableRow>
                    <TableHead className="text-[10px] font-bold uppercase py-3">Receipt #</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase py-3">Patient Name</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase py-3">Payment Method</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase py-3">Reference #</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Amount Paid</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase py-3">Status</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Date & Time</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyError ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-6 text-xs text-rose-600 font-semibold">
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
                    <SkeletonRows rows={6} columns={8} />
                  ) : pagedHistoryTransactions.length > 0 ? (
                    pagedHistoryTransactions.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="py-3 font-extrabold text-xs text-slate-900">{t.receipt_number || `OR-${t.id}`}</TableCell>
                        <TableCell className="py-3 text-xs font-bold text-gray-800">{t.patient_first_name} {t.patient_last_name}</TableCell>
                        <TableCell className="py-3 text-xs">
                          <Badge className="bg-gray-100 text-gray-800 font-bold border-gray-200">
                            {t.payment_method}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-3 text-xs font-mono text-gray-500">{t.reference_number || 'N/A (Cash)'}</TableCell>
                        <TableCell className="py-3 text-xs font-extrabold text-emerald-700 text-right">{formatCurrency(t.amount)}</TableCell>
                        <TableCell className="py-3">
                          <StatusBadge status={t.payment_status || 'Paid'} />
                        </TableCell>
                        <TableCell className="py-3 text-xs text-gray-500 text-right">{new Date(t.paid_at).toLocaleString()}</TableCell>
                        <TableCell className="py-3 text-right">
                          <div className="flex items-center justify-end space-x-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => handleReprintReceipt(t)}
                              className="text-[11px] font-bold border-gray-200 px-2.5 py-1 h-auto flex items-center space-x-1"
                            >
                              <Printer className="w-3 h-3" />
                              <span>Reprint</span>
                            </Button>
                            {(t.payment_status || 'Paid') === 'Paid' && (
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => handleOpenRefund(t)}
                                className="text-[11px] font-bold text-red-600 border-red-200 hover:bg-red-50 px-2.5 py-1 h-auto flex items-center space-x-1"
                              >
                                <Undo2 className="w-3 h-3" />
                                <span>Refund</span>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-6 text-xs text-gray-400 italic">No payments processed in this date range.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <Pagination
              page={historyPage}
              totalPages={historyTotalPages}
              onPageChange={setHistoryPage}
              totalLabel={`${historyTransactions.length} total`}
            />
          </Card>
        </div>
          );
        })()}

        <Dialog open={!!refundTarget} onOpenChange={(open) => !refunding && !open && setRefundTarget(null)}>
          <DialogContent className="max-w-sm rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">Refund Payment</DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                {refundTarget && `Refund ${formatCurrency(refundTarget.amount)} (Receipt ${refundTarget.receipt_number || `OR-${refundTarget.id}`})? This marks the payment as Refunded and cannot be undone from this screen.`}
              </DialogDescription>
            </DialogHeader>

            {refundError && (
              <div role="alert" className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 flex items-center space-x-2 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{refundError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-600 uppercase">Reason <span className="text-red-600">*</span></label>
              <Textarea
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

        {/* Printable Official Receipt Modal Generator */}
        <Dialog open={showReceiptModal} onOpenChange={setShowReceiptModal}>
          <DialogContent className="max-w-md rounded-2xl p-6">
            {paymentSuccess && billDetails && (
              <div className="space-y-4">
                <div className="text-center border-b border-gray-200 pb-3">
                  <h2 className="text-base font-extrabold text-slate-900 uppercase m-0">ENLOGADA CLINIC</h2>
                  <p className="text-[10px] text-gray-500 uppercase font-bold m-0">Official Payment Receipt</p>
                  <span className="text-[11px] font-extrabold text-[#769046] block mt-1">Receipt #: {paymentSuccess.receipt_number || `OR-${paymentSuccess.id}`}</span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">Patient:</span>
                    <span className="font-bold text-slate-900">{billDetails.patientName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">Payment Mode:</span>
                    <span className="font-bold text-slate-900">{paymentSuccess.payment_method}</span>
                  </div>
                </div>

                {billDetails.items && billDetails.items.length > 0 && (
                  <div className="space-y-1.5 py-3 border-t border-b border-gray-100">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Items</span>
                    {billDetails.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-xs">
                        <span className="text-gray-600">{item.name}</span>
                        <span className="font-semibold text-slate-800">{formatCurrency(item.price)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-between text-xs">
                  <span className="text-gray-500 font-medium">Amount Paid:</span>
                  <span className="font-extrabold text-[#769046] text-sm">{formatCurrency(paymentSuccess.amount)}</span>
                </div>

                <div className="pt-3 border-t border-gray-100 flex justify-end space-x-2">
                  <Button onClick={() => window.print()} className="bg-[#769046] text-white font-bold text-xs flex items-center space-x-1">
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print Receipt</span>
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

      </div>
    </SidebarLayout>
  );
};

export default CashierDashboard;
