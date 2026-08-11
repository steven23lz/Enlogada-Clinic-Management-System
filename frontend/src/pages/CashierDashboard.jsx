import React, { useState, useEffect, useCallback } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import MetricCard from '../components/ui/metric-card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { SearchInput } from '../components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { StatusBadge } from '../components/ui/status-badge';
import { Textarea } from '../components/ui/textarea';
import api from '../config/api';
import {
  Receipt,
  Wallet,
  Banknote,
  CheckCircle,
  Printer,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  Clock,
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

// Wait-time triage badge on the billing queue: green under 15 minutes, amber 15-30, rose 30+.
const getWaitInfo = (createdAt) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  let tone = 'bg-emerald-100 text-emerald-700';
  if (minutes >= 30) tone = 'bg-rose-100 text-rose-700';
  else if (minutes >= 15) tone = 'bg-amber-100 text-amber-700';
  return { minutes, tone };
};

const CashierDashboard = ({ activeNav = 'cashier-queue', onSelectNav }) => {
  // Any nav value this component doesn't recognize (e.g. a stale/default 'dashboard') falls
  // back to the primary billing queue view.
  const view = VALID_VIEWS.includes(activeNav) ? activeNav : 'cashier-queue';
  const [activeVisits, setActiveVisits] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
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
    } catch (err) {
      console.error('Failed to fetch active visits:', err);
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

  const fetchTransactionHistory = useCallback(async (startDate, endDate) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await api.get('/payments/transactions', { params: { startDate, endDate } });
      setHistoryTransactions(response.data.data.transactions || []);
    } catch (err) {
      console.error('Failed to fetch transaction history:', err);
      setHistoryError('Could not load transaction history. Please try again.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const handleOpenRefund = (transaction) => {
    setRefundTarget(transaction);
    setRefundReason('');
    setRefundError('');
  };

  const confirmRefund = async () => {
    if (!refundTarget) return;
    setRefunding(true);
    setRefundError('');
    try {
      await api.patch(`/payments/${refundTarget.id}/status`, { status: 'Refunded', reason: refundReason.trim() || undefined });
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
      alert('This visit has already been paid today. Refresh the queue if this looks wrong.');
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
      alert('Failed to retrieve billing summary.');
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
      setPaymentError(`Cash tendered (₱${tendered || 0}) is less than total amount due (₱${totalDue}).`);
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

      // Update visit status to Processing (ready for lab/xray)
      await api.patch(`/visits/${selectedVisit.id}/status`, { status: 'Processing' });

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
        {/* Collections Overview Metrics Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Today's Collections" value={`₱${totalCollectionsToday.toFixed(2)}`} icon={DollarSign} tone="green" />
          <MetricCard label="Cash Collected" value={`₱${cashTotal.toFixed(2)}`} icon={Banknote} tone="emerald" />
          <MetricCard label="E-Wallet (GCash/PayMaya)" value={`₱${eWalletTotal.toFixed(2)}`} icon={Wallet} tone="indigo" />
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
                  <div className="p-8 text-center text-xs text-gray-400 font-semibold">
                    Loading billing queue…
                  </div>
                ) : filteredVisits.length > 0 ? (
                  filteredVisits.map(visit => {
                    const isSelected = selectedVisit?.id === visit.id;
                    const wait = getWaitInfo(visit.created_at);
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
                            <Badge className="bg-amber-100 text-amber-800 text-[10px] font-bold">
                              {visit.patient_type_name || 'Self Pay'}
                            </Badge>
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${wait.tone}`}>
                              <Clock className="w-3 h-3" />
                              {wait.minutes}m waiting
                            </span>
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
                              <TableCell className="py-2.5 text-xs font-bold text-slate-900 text-right">₱{parseFloat(item.price).toFixed(2)}</TableCell>
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
                      <span className="font-bold text-slate-900">₱{parseFloat(billDetails.subtotal).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-600">
                      <span>HMO Coverage / Discount:</span>
                      <span className="font-bold text-emerald-600">- ₱{parseFloat(billDetails.hmoCoverage || 0).toFixed(2)}</span>
                    </div>
                    <div className="pt-2 border-t border-gray-200 flex justify-between items-center text-sm font-extrabold text-slate-900">
                      <span>NET AMOUNT DUE:</span>
                      <span className="text-base text-[#769046]">₱{parseFloat(billDetails.totalAmount).toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Payment Processor Form */}
                  <form onSubmit={handleProcessPayment} className="space-y-4">
                    {paymentError && (
                      <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl flex items-center space-x-2">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{paymentError}</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-600 uppercase block">Select Payment Method</label>
                      <div className="grid grid-cols-4 gap-2">
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
                            <strong>HMO Partner Accredited</strong> — ₱{parseFloat(billDetails.hmoCoverage).toFixed(2)} covered
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
                        <div className="grid grid-cols-2 gap-3">
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
                            <span className="text-base font-extrabold text-emerald-600">₱{calculateChange().toFixed(2)}</span>
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
                <div className="p-12 text-center space-y-3">
                  <Receipt className="w-12 h-12 text-gray-300 mx-auto" />
                  <p className="text-sm font-bold text-gray-400">Select a patient ticket from the left queue to open the billing terminal.</p>
                </div>
              )}
            </Card>
          </div>

        </div>
        </>
        )}

        {view === 'cashier-history' && (
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
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-6 text-xs text-gray-400 font-semibold">Loading transaction history…</TableCell>
                    </TableRow>
                  ) : historyTransactions.length > 0 ? (
                    historyTransactions.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="py-3 font-extrabold text-xs text-slate-900">{t.receipt_number || `OR-${t.id}`}</TableCell>
                        <TableCell className="py-3 text-xs font-bold text-gray-800">{t.first_name} {t.last_name}</TableCell>
                        <TableCell className="py-3 text-xs">
                          <Badge className="bg-gray-100 text-gray-800 font-bold border-gray-200">
                            {t.payment_method}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-3 text-xs font-mono text-gray-500">{t.reference_number || 'N/A (Cash)'}</TableCell>
                        <TableCell className="py-3 text-xs font-extrabold text-emerald-700 text-right">₱{parseFloat(t.amount).toFixed(2)}</TableCell>
                        <TableCell className="py-3">
                          <StatusBadge status={t.payment_status || 'Paid'} />
                        </TableCell>
                        <TableCell className="py-3 text-xs text-gray-500 text-right">{new Date(t.paid_at).toLocaleString()}</TableCell>
                        <TableCell className="py-3 text-right">
                          {(t.payment_status || 'Paid') === 'Paid' && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => handleOpenRefund(t)}
                              className="text-[11px] font-bold text-red-600 border-red-200 hover:bg-red-50 px-2.5 py-1 h-auto flex items-center space-x-1 ml-auto"
                            >
                              <Undo2 className="w-3 h-3" />
                              <span>Refund</span>
                            </Button>
                          )}
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
          </Card>
        </div>
        )}

        <Dialog open={!!refundTarget} onOpenChange={(open) => !refunding && !open && setRefundTarget(null)}>
          <DialogContent className="max-w-sm rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">Refund Payment</DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                {refundTarget && `Refund ₱${parseFloat(refundTarget.amount).toFixed(2)} (Receipt ${refundTarget.receipt_number || `OR-${refundTarget.id}`})? This marks the payment as Refunded and cannot be undone from this screen.`}
              </DialogDescription>
            </DialogHeader>

            {refundError && (
              <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 flex items-center space-x-2 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{refundError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-600 uppercase">Reason (optional)</label>
              <Textarea
                value={refundReason}
                onChange={e => setRefundReason(e.target.value)}
                placeholder="e.g. Duplicate charge, patient dispute..."
                disabled={refunding}
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
          description={billDetails ? `Charge ₱${parseFloat(billDetails.totalAmount).toFixed(2)} via ${paymentMethod} for ${billDetails.patientName}? This will issue a receipt and cannot be undone from this screen.` : ''}
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
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">Amount Paid:</span>
                    <span className="font-extrabold text-[#769046] text-sm">₱{parseFloat(paymentSuccess.amount).toFixed(2)}</span>
                  </div>
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
