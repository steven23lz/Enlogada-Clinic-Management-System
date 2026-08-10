import React, { useState, useEffect, useCallback } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import api from '../config/api';
import { 
  Receipt, 
  Coins, 
  Wallet, 
  CreditCard, 
  Banknote, 
  ShieldAlert, 
  CheckCircle, 
  Printer, 
  Search, 
  User, 
  DollarSign,
  TrendingUp,
  FileCheck,
  Building2,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

const CashierDashboard = ({ activeNav = 'cashier-ops', onSelectNav }) => {
  const [activeVisits, setActiveVisits] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

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

  useEffect(() => {
    fetchActiveVisits();
    fetchTransactions();
  }, [fetchActiveVisits, fetchTransactions]);

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

  const filteredVisits = activeVisits.filter(v => {
    if (paidVisitIds.has(v.id)) return false;
    const matchesSearch = !searchQuery ||
      `${v.first_name} ${v.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (v.queue_number && v.queue_number.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesSearch;
  });

  return (
    <SidebarLayout title="Cashier POS & Billing Terminal" activeNav={activeNav} onSelectNav={onSelectNav}>
      <div className="space-y-6">
        
        {/* Collections Overview Metrics Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Today's Collections</span>
                <span className="text-2xl font-extrabold text-slate-900">₱{totalCollectionsToday.toFixed(2)}</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#769046]/10 text-[#769046] flex items-center justify-center font-bold">
                <DollarSign className="w-5 h-5" />
              </div>
            </div>
          </Card>

          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Cash Collected</span>
                <span className="text-2xl font-extrabold text-emerald-600">₱{cashTotal.toFixed(2)}</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <Banknote className="w-5 h-5" />
              </div>
            </div>
          </Card>

          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">E-Wallet (GCash/PayMaya)</span>
                <span className="text-2xl font-extrabold text-indigo-600">₱{eWalletTotal.toFixed(2)}</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <Wallet className="w-5 h-5" />
              </div>
            </div>
          </Card>

          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Receipts Processed</span>
                <span className="text-2xl font-extrabold text-slate-900">{transactions.length}</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold">
                <Receipt className="w-5 h-5" />
              </div>
            </div>
          </Card>
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

              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search ticket # or name..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#769046]"
                />
              </div>

              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {loading ? (
                  <div className="p-8 text-center text-xs text-gray-400 font-semibold">
                    Loading billing queue…
                  </div>
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
                          <Badge className="bg-amber-100 text-amber-800 text-[10px] font-bold">
                            {visit.patient_type_name || 'Self Pay'}
                          </Badge>
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

        {/* Transaction History Log Table */}
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-900 m-0">Today's Completed Cashier Transactions</h3>
          
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <Table>
              <TableHeader className="bg-gray-50/80">
                <TableRow>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Receipt #</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Patient Name</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Payment Method</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Reference #</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Amount Paid</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Date & Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length > 0 ? (
                  transactions.map(t => (
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
                      <TableCell className="py-3 text-xs text-gray-500 text-right">{new Date(t.paid_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-xs text-gray-400 italic">No payments processed today yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

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
