import React, { useState, useEffect, useCallback } from 'react';
import { Panel, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import Toolbar, { ToolbarField } from '../../components/ui/toolbar';
import EmptyState from '../../components/ui/empty-state';
import MetricCard from '../../components/ui/metric-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SkeletonRows } from '../../components/ui/skeleton';
import Pagination from '../../components/ui/pagination';
import api from '../../config/api';
import { todayStr } from '../../lib/date';
import { formatCurrency } from '../../lib/currency';
import { Receipt, RefreshCw, Banknote, Hash, UserCircle2 } from 'lucide-react';

// Visual Design Improvement Plan Phase V1 — see VISUAL_IDENTITY.md §3a #11.
const PAGE_SIZE = 20;

// Module 12: cashier monitoring — reuses GET /payments/transactions (Module 14's endpoint,
// already Admin/SuperAdmin-authorized) with an admin-facing date range, rather than adding new
// backend surface.
const CashierMonitoring = () => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [page, setPage] = useState(1);

  const fetchTransactions = useCallback(async (from, to) => {
    setLoading(true);
    setPage(1);
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
  const totalPages = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE));
  const pagedTransactions = transactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Oversight"
        icon={Receipt}
        title="Cashier Monitoring"
        description="Every payment taken across all cashiers, for reconciliation and the daily cash-up. Read-only — Admin cannot transact."
      />

      <div>
        <Toolbar attached>
          <ToolbarField label="From" htmlFor="cm-from">
            <Input id="cm-from" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-[150px]" />
          </ToolbarField>
          <ToolbarField label="To" htmlFor="cm-to">
            <Input id="cm-to" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-[150px]" />
          </ToolbarField>
          <div className="flex items-end self-stretch">
            <Button variant="outline" onClick={() => fetchTransactions(startDate, endDate)}>
              <RefreshCw className="h-3.5 w-3.5" />
              Apply
            </Button>
          </div>
        </Toolbar>

        <Panel className="overflow-hidden rounded-t-none">
          {/* The range summary sits inside the table's panel rather than in a separate KPI strip
              above the filters. These figures describe *this* result set — floating them away
              from the range that produced them was how they got read as clinic-wide totals. */}
          <div className="grid grid-cols-2 gap-px border-b border-[#e6ebf1] bg-[#e6ebf1] lg:grid-cols-4">
            <MetricCard
              className="rounded-none border-0"
              label="Collections in range"
              value={formatCurrency(total)}
              icon={Banknote}
              tone="emerald"
            />
            <MetricCard
              className="rounded-none border-0"
              label="Transactions"
              value={transactions.length}
              icon={Hash}
              tone="slate"
            />
            {Object.entries(byCashier).slice(0, 2).map(([name, amt]) => (
              <MetricCard
                key={name}
                className="rounded-none border-0"
                label={name}
                value={formatCurrency(amt)}
                caption="Collected by this cashier"
                captionTone="slate"
                icon={UserCircle2}
                tone="indigo"
              />
            ))}
          </div>

          <PanelBody flush>
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Receipt #</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonRows rows={6} columns={6} />
                ) : pagedTransactions.length > 0 ? (
                  pagedTransactions.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-fine font-semibold text-slate-900">{t.receipt_number || `OR-${t.id}`}</TableCell>
                      <TableCell className="max-w-[160px] truncate" title={`${t.processed_by_first_name} ${t.processed_by_last_name}`}>{t.processed_by_first_name} {t.processed_by_last_name}</TableCell>
                      <TableCell className="max-w-[160px] truncate font-medium text-slate-900" title={`${t.patient_first_name} ${t.patient_last_name}`}>{t.patient_first_name} {t.patient_last_name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-slate-600">{t.payment_method}</Badge></TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-emerald-700">{formatCurrency(t.amount)}</TableCell>
                      <TableCell className="text-right text-fine text-slate-500">{new Date(t.paid_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState
                        icon={Receipt}
                        title="No payments in this date range"
                        description="Widen the range above, or check that the cashier has settled today's bills."
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </PanelBody>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            totalLabel={`${transactions.length} transaction${transactions.length === 1 ? '' : 's'}`}
          />
        </Panel>
      </div>
    </div>
  );
};

export default CashierMonitoring;
