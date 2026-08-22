import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import PageHeader from '../../components/ui/page-header';
import useOperationsReport from '../../hooks/useOperationsReport';
import {
  BillingTotalsPanel,
  SalesByServicePanel,
  ReceptionThroughputPanel,
  TurnaroundPanel,
} from '../../components/reports/OperationsPanels';
import Toolbar, { ToolbarField, ToolbarSpacer } from '../../components/ui/toolbar';
import EmptyState from '../../components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import MetricCard from '../../components/ui/metric-card';
import RevenueTrendChart from '../../components/charts/RevenueTrendChart';
import CategoryVolumeChart from '../../components/charts/CategoryVolumeChart';
import api from '../../config/api';
import { formatCurrency } from '../../lib/currency';
// `todayStr` / `daysAgoStr` were re-implemented locally at the top of this file. The local copies
// were correct (built from local getters, not toISOString), but a second correct copy is still a
// second place for the toISOString bug to come back — see the dates note in CLAUDE.md.
import { todayStr, daysAgoStr } from '../../lib/date';
import { settled } from '../../lib/collections';
import { ClipboardList, FileText, Info, RefreshCw, ShieldCheck, DollarSign, Users, FlaskConical, Printer, BarChart3, TrendingUp } from 'lucide-react';
import { DateField, RANGE_PRESETS } from '../../components/ui/date-field';

const STATUS_COLORS = {
  Pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  Processing: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  Completed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  Cancelled: 'bg-rose-50 text-rose-800 ring-rose-200',
};

// --- Today's Snapshot (Module 12's original reporting entry point; logic unchanged) --------
const TodaySnapshot = () => {
  const [todayTotal, setTodayTotal] = useState(0);
  const [yesterdayTotal, setYesterdayTotal] = useState(0);
  const [activeQueueCount, setActiveQueueCount] = useState(0);
  const [catalogCount, setCatalogCount] = useState(0);
  const [methodBreakdown, setMethodBreakdown] = useState({});
  const [loading, setLoading] = useState(true);
  // The most dangerous silent failure in the app. Every figure here initialises to 0, so a
  // failed fetch left the screen stating "Today's Revenue PHP 0.00, +0% vs yesterday" and
  // "No payments yet today" — confident, specific and false. A manager reads that as the
  // clinic having taken nothing, not as the server being down, and the two call for opposite
  // responses. A blank panel would have been safer than this was.
  const [snapshotError, setSnapshotError] = useState('');

  const fetchReportData = useCallback(async () => {
    setLoading(true);
    setSnapshotError('');
    try {
      const today = todayStr();
      const yesterday = daysAgoStr(1);

      const [todayRes, yesterdayRes, visitsRes, testsRes] = await Promise.all([
        api.get('/payments/transactions', { params: { startDate: today, endDate: today } }),
        api.get('/payments/transactions', { params: { startDate: yesterday, endDate: yesterday } }),
        api.get('/visits/active'),
        api.get('/tests'),
      ]);

      const todayTx = todayRes.data.data.transactions || [];

      // Both totals come from the endpoint's SQL summary. The lists below include receipts that
      // were later reversed, so reducing them would count a refund as income.
      setTodayTotal(Number(todayRes.data.data.summary?.collected || 0));
      setYesterdayTotal(Number(yesterdayRes.data.data.summary?.collected || 0));
      setActiveQueueCount((visitsRes.data.data.visits || []).length);
      setCatalogCount((testsRes.data.data.tests || []).length);

      // Grouped by method, which the summary does not carry — so it is filtered explicitly.
      // Safe to reduce here only because this fetch is unpaged.
      const breakdown = settled(todayTx).reduce((acc, t) => {
        acc[t.payment_method] = (acc[t.payment_method] || 0) + parseFloat(t.amount || 0);
        return acc;
      }, {});
      setMethodBreakdown(breakdown);
    } catch (err) {
      console.error('Failed to fetch report data:', err);
      setSnapshotError(err.response?.data?.message || "Today's figures could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  const percentChange = yesterdayTotal > 0
    ? ((todayTotal - yesterdayTotal) / yesterdayTotal) * 100
    : (todayTotal > 0 ? 100 : 0);
  const isUp = percentChange >= 0;

  // Nothing numeric is shown at all when the fetch failed. Showing the tiles with a caveat
  // beside them would still put a wrong peso figure on screen, and the figure is what gets read.
  if (snapshotError) {
    return (
      <Card className="border-[#e6ebf1] rounded-xl bg-white">
        <EmptyState
          tone="error"
          title="Today's figures are unavailable"
          description={snapshotError}
          action={<Button variant="outline" size="sm" onClick={fetchReportData}>Try again</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard
          label="Today's Revenue"
          value={loading ? '…' : formatCurrency(todayTotal)}
          icon={DollarSign}
          tone="emerald"
          trend={!loading ? { direction: isUp ? 'up' : 'down', label: `${isUp ? '+' : ''}${percentChange.toFixed(0)}% vs yesterday (${formatCurrency(yesterdayTotal)})` } : undefined}
        />
        <MetricCard
          label="Active Queue"
          value={loading ? '…' : activeQueueCount}
          icon={ClipboardList}
          tone="indigo"
          caption="Pending + Processing visits today"
        />
        <MetricCard
          label="Services Catalog"
          value={loading ? '…' : catalogCount}
          icon={FileText}
          tone="green"
          caption="Active diagnostic services"
        />

        <Card className="border-[#e6ebf1] rounded-xl bg-white p-5 space-y-1">
          <span className="field-label">Payment Methods (Today)</span>
          {loading ? (
            <div className="text-2xl font-extrabold text-slate-900">…</div>
          ) : Object.keys(methodBreakdown).length === 0 ? (
            <p className="text-xs text-slate-500 m-0">No payments yet today.</p>
          ) : (
            <div className="space-y-0.5 pt-1">
              {Object.entries(methodBreakdown).map(([method, amt]) => (
                <div key={method} className="flex justify-between text-fine font-semibold text-gray-700">
                  <span>{method}</span>
                  <span className="font-bold text-slate-900">{formatCurrency(amt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Two things were wrong with this. It pointed at a "Date-Range Reports" tab that does not
          exist — the tab was renamed to Trends and this copy was not — so the one instruction on
          the screen sent the reader looking for something they would never find.

          And it was a full-width dark slab: on a tab whose content ends halfway down the
          viewport, the single heaviest element on the page was a footnote. It is the same inline
          alert every other advisory note in the app uses now. */}
      <div role="note" className="alert alert-info">
        <Info />
        <span>
          A live snapshot of today only. For historical trends and a custom date range, see the{' '}
          <strong>Trends</strong> tab.
        </span>
      </div>
    </div>
  );
};

// --- Date-Range Reports: revenue trend, service volume, operational breakdown (Module 17) --
const DateRangeReports = () => {
  const [startDate, setStartDate] = useState(daysAgoStr(6));
  const [endDate, setEndDate] = useState(todayStr());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchReport = useCallback(async (from, to) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/reports/summary', { params: { startDate: from, endDate: to } });
      setReport(res.data.data.report);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load report data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport(startDate, endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revenueTrend = report?.revenueTrend || [];
  const serviceVolume = report?.serviceVolume || [];
  const visitStatusBreakdown = report?.visitStatusBreakdown || [];
  const paymentMethodBreakdown = report?.paymentMethodBreakdown || [];

  const totalRevenue = revenueTrend.reduce((s, r) => s + parseFloat(r.total), 0);
  const totalVisits = visitStatusBreakdown.reduce((s, v) => s + parseInt(v.visit_count, 10), 0);

  return (
    <div className="space-y-5">
      {/* No PageHeader here. This renders inside the Date Range tab of ReportsOverview, which
          already titles the page — a second one printed "Clinic Reports" twice down the screen,
          the same duplicate-title problem the breadcrumb change fixed on the console shells. The
          tab label says which view this is; the one line worth keeping is the print hint. */}
      <p className="m-0 text-fine leading-relaxed text-slate-500">
        Revenue, service volume and operational metrics for a chosen period. Print produces a clean
        report without the app chrome.
      </p>

      <Toolbar>
        <ToolbarField label="From" htmlFor="rep-from">
          <DateField id="rep-from" presets={RANGE_PRESETS.start} value={startDate} onChange={(e) => setStartDate(e.target.value)} containerClassName="w-[150px]" />
        </ToolbarField>
        <ToolbarField label="To" htmlFor="rep-to">
          <DateField id="rep-to" presets={RANGE_PRESETS.end} value={endDate} onChange={(e) => setEndDate(e.target.value)} containerClassName="w-[150px]" />
        </ToolbarField>
        <div className="flex items-end self-stretch">
          <Button variant="outline" onClick={() => fetchReport(startDate, endDate)}>
            <RefreshCw className="h-3.5 w-3.5" />
            Apply
          </Button>
        </div>
        <ToolbarSpacer />
        <div className="flex items-end self-stretch">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Print Reports
          </Button>
        </div>
      </Toolbar>

      {error && (
        <div role="alert" className="alert alert-error">
          <Info />
          <span>{error}</span>
        </div>
      )}

      <div className="print-area space-y-6">
      <div className="hidden print:block text-center border-b border-[#e6ebf1] pb-3 mb-3">
        <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide m-0">Enlogada Ultrasound &amp; Diagnostic Clinic</h3>
        <p className="text-xs text-gray-500 m-0">Clinic Report — {startDate} to {endDate}</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="border-[#e6ebf1] rounded-xl bg-white overflow-hidden">
          <CardHeader className="space-y-0.5 border-b border-[#e6ebf1] px-5 py-3.5">
            <CardTitle className="text-[13px] font-semibold text-slate-900">Revenue Trend</CardTitle>
            <p className="text-fine text-gray-500 m-0">Total for range: <span className="font-bold text-slate-900">{formatCurrency(totalRevenue)}</span></p>
          </CardHeader>
          <CardContent className="p-5">
            {loading ? (
              <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
            ) : revenueTrend.length === 0 ? (
              <EmptyState compact icon={TrendingUp} title="No paid transactions in this range" description="Widen the date range above, or check that the cashier has settled the day's bills." />
            ) : (
              <RevenueTrendChart data={revenueTrend} />
            )}
          </CardContent>
        </Card>

        <Card className="border-[#e6ebf1] rounded-xl bg-white overflow-hidden">
          <CardHeader className="border-b border-[#e6ebf1] px-5 py-3.5">
            <CardTitle className="text-[13px] font-semibold text-slate-900">Service Volume by Category</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {loading ? (
              <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
            ) : serviceVolume.length === 0 ? (
              <EmptyState compact icon={FlaskConical} title="No tests recorded in this range" description="Volume is counted from tests attached to a visit, not from bookings." />
            ) : (
              <CategoryVolumeChart data={serviceVolume} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="border-[#e6ebf1] rounded-xl bg-white overflow-hidden">
          <CardHeader className="border-b border-[#e6ebf1] px-5 py-3.5">
            <CardTitle className="text-[13px] font-semibold text-slate-900">Visit Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {loading ? (
              <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
            ) : visitStatusBreakdown.length === 0 ? (
              <EmptyState compact icon={ClipboardList} title="No visits in this range" description="Walk-ins and checked-in appointments both count as visits." />
            ) : (
              <div className="flex flex-wrap gap-2">
                {visitStatusBreakdown.map((row) => (
                  <Badge key={row.status} variant="outline" className={`text-fine font-bold px-3 py-1.5 ${STATUS_COLORS[row.status] || 'border-gray-200 text-gray-700'}`}>
                    {row.status}: {row.visit_count} ({totalVisits > 0 ? Math.round((row.visit_count / totalVisits) * 100) : 0}%)
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[#e6ebf1] rounded-xl bg-white overflow-hidden">
          <CardHeader className="border-b border-[#e6ebf1] px-5 py-3.5">
            <CardTitle className="text-[13px] font-semibold text-slate-900">Payment Method Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={3} className="py-10 text-center text-fine text-slate-400">Loading…</TableCell></TableRow>
                ) : paymentMethodBreakdown.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="p-0"><EmptyState compact icon={DollarSign} title="No payments in this range" description="Method breakdown fills in once bills are settled." /></TableCell></TableRow>
                ) : (
                  paymentMethodBreakdown.map((row) => (
                    <TableRow key={row.payment_method}>
                      <TableCell className="py-3 text-xs font-semibold text-slate-800">{row.payment_method}</TableCell>
                      <TableCell className="py-3 text-xs text-right text-gray-600">{row.payment_count}</TableCell>
                      <TableCell className="py-3 text-xs text-right font-bold text-slate-900">{formatCurrency(row.total)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
};

// --- RBAC Matrix report (read-only). Editing stays SuperAdmin-only under Super Admin
// Management (Module 13) — this closes a real gap where Admin, already authorized server-side
// for GET /rbac/matrix, had no UI path to view it at all (the only viewer was gated to
// SuperAdmin alone in the sidebar nav). -----------------------------------------------------
const RbacMatrixReport = () => {
  const [roles, setRoles] = useState([]);
  const [rolePermissions, setRolePermissions] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/rbac/matrix');
        setRoles(res.data.data.roles || []);
        setRolePermissions(res.data.data.rolePermissions || {});
      } catch (err) {
        console.error('Failed to fetch RBAC matrix:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-3">
      <Card className="border-[#e6ebf1] rounded-xl bg-white overflow-hidden">
        <CardHeader className="border-b border-[#e6ebf1] px-5 py-3.5">
          <CardTitle className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
            <ShieldCheck className="w-4 h-4 text-brand-600" />
            <span>Roles &amp; Their Assigned Permissions</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Permissions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={2} className="py-10 text-center text-fine text-slate-400">Loading role matrix…</TableCell></TableRow>
              ) : (
                roles.map((role) => (
                  <TableRow key={role.id} className="align-top">
                    <TableCell className="py-3 font-bold text-xs text-slate-900 whitespace-nowrap">{role.name}</TableCell>
                    <TableCell className="py-3">
                      {/* Sorted, so the rows can be compared against each other — which is the
                          only thing a matrix is for. They arrived in whatever order the join
                          returned, so `patients:read_all_departments` sat last on SuperAdmin,
                          first on Admin and last again on Cashier, and checking whether two roles
                          differ meant reading every chip in both rows rather than scanning down a
                          column. Sorting is by the resource before the colon and then the action,
                          which is how the permission names are already built. */}
                      <div className="flex flex-wrap gap-1 max-w-2xl">
                        {(rolePermissions[role.name] || []).length > 0 ? (
                          [...(rolePermissions[role.name] || [])].sort((a, b) => a.localeCompare(b)).map((permName) => (
                            <Badge key={permName} variant="outline" className="text-meta font-semibold border-gray-200">{permName}</Badge>
                          ))
                        ) : (
                          <span className="text-fine text-slate-500">No permissions assigned</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-fine text-gray-400 px-1">Read-only. Editing role permissions is a SuperAdmin-only capability under Super Admin Management.</p>
    </div>
  );
};

// Feature Gap Plan Phase D finding 04: staff workload visibility existed for Cashier only
// (CashierMonitoring.jsx's byCashier) — Reception and Diagnostic had no per-staff throughput
// view at all. Mirrors that same "group collections by staff member" shape, server-side, for
// the other two departments.
const StaffWorkload = () => {
  const [startDate, setStartDate] = useState(daysAgoStr(6));
  const [endDate, setEndDate] = useState(todayStr());
  const [receptionWorkload, setReceptionWorkload] = useState([]);
  const [diagnosticWorkload, setDiagnosticWorkload] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchWorkload = useCallback(async (from, to) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/reports/staff-workload', { params: { startDate: from, endDate: to } });
      setReceptionWorkload(res.data.data.workload?.receptionWorkload || []);
      setDiagnosticWorkload(res.data.data.workload?.diagnosticWorkload || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load staff workload.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkload(startDate, endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Diagnostic results are grouped by (staff, category) server-side — collapse to one row per
  // staff member here, with a per-category breakdown, so the two tables read the same way.
  const diagnosticByStaff = diagnosticWorkload.reduce((acc, row) => {
    const key = row.staff_id;
    if (!acc[key]) acc[key] = { staff_id: key, first_name: row.first_name, last_name: row.last_name, total: 0, byCategory: [] };
    acc[key].total += parseInt(row.result_count, 10);
    acc[key].byCategory.push({ category: row.category_name, count: parseInt(row.result_count, 10) });
    return acc;
  }, {});
  const diagnosticRows = Object.values(diagnosticByStaff).sort((a, b) => b.total - a.total);

  const maxReceptionCount = Math.max(1, ...receptionWorkload.map(r => parseInt(r.visit_count, 10)));
  const maxDiagnosticCount = Math.max(1, ...diagnosticRows.map(r => r.total));

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-[#e6ebf1]">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-slate-900 m-0">Per-Staff Workload</h3>
          <p className="text-xs text-gray-500 m-0">Reception check-ins and Diagnostic results released, by staff member.</p>
        </div>
        <div className="flex items-center space-x-2">
          <DateField presets={RANGE_PRESETS.start} value={startDate} onChange={(e) => setStartDate(e.target.value)} containerClassName="w-36" aria-label="Workload start date" />
          <span className="text-xs text-gray-400">to</span>
          <DateField presets={RANGE_PRESETS.end} value={endDate} onChange={(e) => setEndDate(e.target.value)} containerClassName="w-36" aria-label="Workload end date" />
          <Button variant="outline" onClick={() => fetchWorkload(startDate, endDate)} className="flex items-center space-x-1.5 text-xs font-semibold">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Apply</span>
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl p-3 flex items-center gap-2">
          {error}{' '}
          <button type="button" onClick={() => fetchWorkload(startDate, endDate)} className="underline font-bold border-0 bg-transparent cursor-pointer text-rose-800">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="border-[#e6ebf1] rounded-xl bg-white overflow-hidden">
          <CardHeader className="flex flex-row items-center gap-2.5 border-b border-[#e6ebf1] px-5 py-3.5">
            <Users className="w-4 h-4 text-brand-600" />
            <CardTitle className="text-[13px] font-semibold text-slate-900">Reception — Check-Ins by Staff</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            {loading ? (
              <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
            ) : receptionWorkload.length === 0 ? (
              <EmptyState compact icon={ClipboardList} title="No visits in this range" description="Walk-ins and checked-in appointments both count as visits." />
            ) : (
              receptionWorkload.map(row => (
                <div key={row.staff_id} className="space-y-1">
                  <div className="flex justify-between text-fine font-semibold text-gray-700">
                    <span>{row.first_name} {row.last_name}</span>
                    <span className="font-bold text-slate-900">{row.visit_count}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-brand-500"
                      style={{ width: `${Math.max(4, (parseInt(row.visit_count, 10) / maxReceptionCount) * 100)}%` }}
                      role="img"
                      aria-label={`${row.visit_count} check-ins by ${row.first_name} ${row.last_name}`}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-[#e6ebf1] rounded-xl bg-white overflow-hidden">
          <CardHeader className="flex flex-row items-center gap-2.5 border-b border-[#e6ebf1] px-5 py-3.5">
            <FlaskConical className="w-4 h-4 text-brand-600" />
            <CardTitle className="text-[13px] font-semibold text-slate-900">Diagnostic — Results Released by Staff</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            {loading ? (
              <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
            ) : diagnosticRows.length === 0 ? (
              <p className="py-10 text-center text-fine text-slate-500">No results released in this range.</p>
            ) : (
              diagnosticRows.map(row => (
                <div key={row.staff_id} className="space-y-1">
                  <div className="flex justify-between text-fine font-semibold text-gray-700">
                    <span>
                      {row.first_name} {row.last_name}
                      <span className="text-gray-400 font-normal"> &middot; {row.byCategory.map(c => `${c.category} ${c.count}`).join(', ')}</span>
                    </span>
                    <span className="font-bold text-slate-900">{row.total}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-indigo-500"
                      style={{ width: `${Math.max(4, (row.total / maxDiagnosticCount) * 100)}%` }}
                      role="img"
                      aria-label={`${row.total} results released by ${row.first_name} ${row.last_name}`}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// Module 12 originally built this page's "Today's Snapshot" as an honest, minimal entry point
// and explicitly deferred historical trends, date-range filtering, and the RBAC matrix report
// to this module. That live snapshot logic is unchanged here — only added to, not replaced.
/**
 * Every department's operating figures on one page. [1.22.0]
 *
 * The roll-up the Admin asked for: the same panels each console shows its own department, side by
 * side and unrestricted. Literally the same components — a manager querying a department's
 * numbers has to be reading the version that department reads, or the conversation starts with an
 * argument about whose figures are right.
 */
const OperationsReport = () => {
  const { report, loading, error, range, setRange, refresh } = useOperationsReport({ days: 7 });

  if (error === 'forbidden') {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No departments to report on"
        description="This account holds no billing, visit or result permission, so there is nothing here to show."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Toolbar>
        <ToolbarField label="From" htmlFor="ops-from">
          <DateField
            id="ops-from"
            presets={RANGE_PRESETS.start}
            value={range.startDate}
            onChange={(e) => setRange((r) => ({ ...r, startDate: e.target.value }))}
            containerClassName="w-[150px]"
          />
        </ToolbarField>
        <ToolbarField label="To" htmlFor="ops-to">
          <DateField
            id="ops-to"
            presets={RANGE_PRESETS.end}
            value={range.endDate}
            onChange={(e) => setRange((r) => ({ ...r, endDate: e.target.value }))}
            containerClassName="w-[150px]"
          />
        </ToolbarField>
        <div className="flex items-end self-stretch">
          <Button variant="outline" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" />
            Apply
          </Button>
        </div>
        <ToolbarSpacer />
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" />
          Print
        </Button>
      </Toolbar>

      {error && error !== 'forbidden' && (
        <div role="alert" className="alert alert-error">
          <Info />
          <span>{error}</span>
        </div>
      )}

      <div className="print-area space-y-4">
        {report?.billing && (
          <>
            <BillingTotalsPanel billing={report.billing} loading={loading} />
            <SalesByServicePanel billing={report.billing} loading={loading} />
          </>
        )}
        {report?.reception && <ReceptionThroughputPanel reception={report.reception} loading={loading} />}
        {report?.diagnostics && <TurnaroundPanel diagnostics={report.diagnostics} loading={loading} />}
      </div>
    </div>
  );
};

// Module 12 originally built this page's "Today's Snapshot" as an honest, minimal entry point
// and explicitly deferred historical trends, date-range filtering, and the RBAC matrix report
// to this module. That live snapshot logic is unchanged here — only added to, not replaced.
const ReportsOverview = () => {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Oversight"
        icon={BarChart3}
        title="Clinic Reports"
        description="Live activity, historical trends, and every department's operating figures in one place."
      />

      <Tabs defaultValue="snapshot" className="w-full space-y-4">
        <TabsList>
          <TabsTrigger value="snapshot">Today</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="range">Trends</TabsTrigger>
          <TabsTrigger value="workload">Staff Workload</TabsTrigger>
          <TabsTrigger value="rbac">RBAC Matrix</TabsTrigger>
        </TabsList>
        <TabsContent value="snapshot" className="m-0">
          <TodaySnapshot />
        </TabsContent>
        <TabsContent value="operations" className="m-0">
          <OperationsReport />
        </TabsContent>
        <TabsContent value="range" className="m-0">
          <DateRangeReports />
        </TabsContent>
        <TabsContent value="workload" className="m-0">
          <StaffWorkload />
        </TabsContent>
        <TabsContent value="rbac" className="m-0">
          <RbacMatrixReport />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ReportsOverview;
