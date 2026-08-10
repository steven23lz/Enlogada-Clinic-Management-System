import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import api from '../../config/api';
import { Receipt, RefreshCw } from 'lucide-react';

const todayStr = () => new Date().toISOString().slice(0, 10);

// Module 12: cashier monitoring — reuses GET /payments/transactions (Module 14's endpoint,
// already Admin/SuperAdmin-authorized) with an admin-facing date range, rather than adding new
// backend surface.
const CashierMonitoring = () => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());

  const fetchTransactions = useCallback(async (from, to) => {
    setLoading(true);
    try {
      const res = await api.get('/payments/transactions', { params: { startDate: from, endDate: to } });
      setTransactions(res.data.data.transactions || []);
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions(startDate, endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = transactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
  const byCashier = transactions.reduce((acc, t) => {
    const name = t.processed_by_first_name ? `${t.processed_by_first_name} ${t.processed_by_last_name}` : 'Unknown';
    acc[name] = (acc[name] || 0) + parseFloat(t.amount || 0);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-100 shadow-xs">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900 m-0">Cashier Monitoring</h2>
          <p className="text-xs text-gray-500 m-0">Oversight of payment transactions processed across all cashiers.</p>
        </div>
        <div className="flex items-center space-x-2">
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-xs w-36" />
          <span className="text-xs text-gray-400">to</span>
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-xs w-36" />
          <Button
            variant="outline"
            onClick={() => fetchTransactions(startDate, endDate)}
            className="flex items-center space-x-1.5 text-xs font-semibold"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Apply</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Total Collections (Range)</span>
          <span className="text-2xl font-extrabold text-slate-900">₱{total.toFixed(2)}</span>
        </Card>
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Transactions</span>
          <span className="text-2xl font-extrabold text-slate-900">{transactions.length}</span>
        </Card>
        {Object.entries(byCashier).slice(0, 2).map(([name, amt]) => (
          <Card key={name} className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">{name}</span>
            <span className="text-2xl font-extrabold text-emerald-600">₱{amt.toFixed(2)}</span>
          </Card>
        ))}
      </div>

      <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
        <CardHeader className="border-b border-gray-100 py-4 px-6 flex flex-row items-center space-x-2">
          <Receipt className="w-4 h-4 text-[#769046]" />
          <CardTitle className="text-sm font-bold text-slate-800">Transaction Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-gray-50/80">
              <TableRow>
                <TableHead className="text-[10px] font-bold uppercase py-3">Receipt #</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Cashier</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Patient</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Method</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Amount</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Paid At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-6 text-xs text-gray-400">Loading transactions…</TableCell></TableRow>
              ) : transactions.length > 0 ? (
                transactions.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="py-3 font-extrabold text-xs text-slate-900">{t.receipt_number || `OR-${t.id}`}</TableCell>
                    <TableCell className="py-3 text-xs text-gray-700">{t.processed_by_first_name} {t.processed_by_last_name}</TableCell>
                    <TableCell className="py-3 text-xs text-gray-700">{t.patient_first_name} {t.patient_last_name}</TableCell>
                    <TableCell className="py-3 text-xs"><Badge className="bg-gray-100 text-gray-800 font-bold border-gray-200">{t.payment_method}</Badge></TableCell>
                    <TableCell className="py-3 text-xs font-extrabold text-emerald-700 text-right">₱{parseFloat(t.amount).toFixed(2)}</TableCell>
                    <TableCell className="py-3 text-xs text-gray-500 text-right">{new Date(t.paid_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={6} className="text-center py-6 text-xs text-gray-400 italic">No transactions in this date range.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default CashierMonitoring;
