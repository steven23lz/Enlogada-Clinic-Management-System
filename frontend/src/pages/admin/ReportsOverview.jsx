import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import MetricCard from '../../components/ui/metric-card';
import api from '../../config/api';
import { ClipboardList, FileText, Info, RefreshCw, ShieldCheck, DollarSign } from 'lucide-react';

const dateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const todayStr = () => dateStr(new Date());
const daysAgoStr = (n) => dateStr(new Date(Date.now() - n * 86400000));

const STATUS_COLORS = {
  Pending: 'bg-amber-100 text-amber-700 border-amber-200',
  Processing: 'bg-blue-100 text-blue-700 border-blue-200',
  Completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Cancelled: 'bg-rose-100 text-rose-700 border-rose-200',
};

// --- Today's Snapshot (Module 12's original reporting entry point; logic unchanged) --------
const TodaySnapshot = () => {
  const [todayTotal, setTodayTotal] = useState(0);
  const [yesterdayTotal, setYesterdayTotal] = useState(0);
  const [activeQueueCount, setActiveQueueCount] = useState(0);
  const [catalogCount, setCatalogCount] = useState(0);
  const [methodBreakdown, setMethodBreakdown] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchReportData = useCallback(async () => {
    setLoading(true);
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
      const yesterdayTx = yesterdayRes.data.data.transactions || [];

      setTodayTotal(todayTx.reduce((s, t) => s + parseFloat(t.amount || 0), 0));
      setYesterdayTotal(yesterdayTx.reduce((s, t) => s + parseFloat(t.amount || 0), 0));
      setActiveQueueCount((visitsRes.data.data.visits || []).length);
      setCatalogCount((testsRes.data.data.tests || []).length);

      const breakdown = todayTx.reduce((acc, t) => {
        acc[t.payment_method] = (acc[t.payment_method] || 0) + parseFloat(t.amount || 0);
        return acc;
      }, {});
      setMethodBreakdown(breakdown);
    } catch (err) {
      console.error('Failed to fetch report data:', err);
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard
          label="Today's Revenue"
          value={loading ? '…' : `₱${todayTotal.toFixed(2)}`}
          icon={DollarSign}
          tone="emerald"
          trend={!loading ? { direction: isUp ? 'up' : 'down', label: `${isUp ? '+' : ''}${percentChange.toFixed(0)}% vs yesterday (₱${yesterdayTotal.toFixed(2)})` } : undefined}
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

        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-5 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Payment Methods (Today)</span>
          {loading ? (
            <div className="text-2xl font-extrabold text-slate-900">…</div>
          ) : Object.keys(methodBreakdown).length === 0 ? (
            <p className="text-xs text-gray-400 italic m-0">No payments yet today.</p>
          ) : (
            <div className="space-y-0.5 pt-1">
              {Object.entries(methodBreakdown).map(([method, amt]) => (
                <div key={method} className="flex justify-between text-[11px] font-semibold text-gray-700">
                  <span>{method}</span>
                  <span className="font-bold text-slate-900">₱{amt.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="bg-[#192534] text-white rounded-2xl p-5 flex items-start space-x-3">
        <Info className="w-5 h-5 text-[#769046] flex-shrink-0 mt-0.5" />
        <p className="text-xs text-gray-300 m-0 leading-relaxed">
          This is a live snapshot of today's activity only. For historical trends and a custom
          date range, see the <strong className="text-white">Date-Range Reports</strong> tab.
        </p>
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
  const maxRevenue = Math.max(1, ...revenueTrend.map((r) => parseFloat(r.total)));
  const maxVolume = Math.max(1, ...serviceVolume.map((s) => parseInt(s.test_count, 10)));
  const totalVisits = visitStatusBreakdown.reduce((s, v) => s + parseInt(v.visit_count, 10), 0);

  const formatDay = (isoDay) => {
    const d = new Date(`${isoDay}T00:00:00`);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-100 shadow-xs">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-slate-900 m-0">Custom Date Range</h3>
          <p className="text-xs text-gray-500 m-0">Revenue, service volume, and operational metrics for the selected period.</p>
        </div>
        <div className="flex items-center space-x-2">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="text-xs w-36" />
          <span className="text-xs text-gray-400">to</span>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="text-xs w-36" />
          <Button
            variant="outline"
            onClick={() => fetchReport(startDate, endDate)}
            className="flex items-center space-x-1.5 text-xs font-semibold"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Apply</span>
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-xl p-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-gray-100 py-4 px-6 space-y-0.5">
            <CardTitle className="text-sm font-bold text-slate-800">Revenue Trend</CardTitle>
            <p className="text-[11px] text-gray-500 m-0">Total for range: <span className="font-bold text-slate-900">₱{totalRevenue.toFixed(2)}</span></p>
          </CardHeader>
          <CardContent className="p-5">
            {loading ? (
              <p className="text-xs text-gray-400 text-center py-6">Loading…</p>
            ) : revenueTrend.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-6">No paid transactions in this range.</p>
            ) : (
              <div className="flex items-end space-x-2 overflow-x-auto pb-1" style={{ minHeight: '140px' }}>
                {revenueTrend.map((row) => {
                  const value = parseFloat(row.total);
                  const heightPct = Math.max(4, (value / maxRevenue) * 100);
                  return (
                    <div key={row.day} className="flex flex-col items-center space-y-1 flex-shrink-0" style={{ width: '44px' }}>
                      <span className="text-[10px] font-bold text-slate-700">₱{value.toFixed(0)}</span>
                      <div
                        className="w-full rounded-t-md bg-[#769046]"
                        style={{ height: `${heightPct}px`, maxHeight: '100px' }}
                        role="img"
                        aria-label={`₱${value.toFixed(2)} on ${row.day}`}
                      />
                      <span className="text-[9px] text-gray-400 font-semibold whitespace-nowrap">{formatDay(row.day)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-gray-100 py-4 px-6">
            <CardTitle className="text-sm font-bold text-slate-800">Service Volume by Category</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            {loading ? (
              <p className="text-xs text-gray-400 text-center py-6">Loading…</p>
            ) : serviceVolume.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-6">No tests attached to visits in this range.</p>
            ) : (
              serviceVolume.map((row) => {
                const count = parseInt(row.test_count, 10);
                const widthPct = Math.max(4, (count / maxVolume) * 100);
                return (
                  <div key={row.category_name} className="space-y-1">
                    <div className="flex justify-between text-[11px] font-semibold text-gray-700">
                      <span>{row.category_name}</span>
                      <span className="font-bold text-slate-900">{count}</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-gray-100">
                      <div
                        className="h-2 rounded-full bg-indigo-500"
                        style={{ width: `${widthPct}%` }}
                        role="img"
                        aria-label={`${count} ${row.category_name} tests`}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-gray-100 py-4 px-6">
            <CardTitle className="text-sm font-bold text-slate-800">Visit Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {loading ? (
              <p className="text-xs text-gray-400 text-center py-6">Loading…</p>
            ) : visitStatusBreakdown.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-6">No visits created in this range.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {visitStatusBreakdown.map((row) => (
                  <Badge key={row.status} variant="outline" className={`text-[11px] font-bold px-3 py-1.5 ${STATUS_COLORS[row.status] || 'border-gray-200 text-gray-700'}`}>
                    {row.status}: {row.visit_count} ({totalVisits > 0 ? Math.round((row.visit_count / totalVisits) * 100) : 0}%)
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-gray-100 py-4 px-6">
            <CardTitle className="text-sm font-bold text-slate-800">Payment Method Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader className="bg-gray-50/80">
                <TableRow>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Method</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Payments</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-6 text-xs text-gray-400">Loading…</TableCell></TableRow>
                ) : paymentMethodBreakdown.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-6 text-xs text-gray-400 italic">No paid transactions in this range.</TableCell></TableRow>
                ) : (
                  paymentMethodBreakdown.map((row) => (
                    <TableRow key={row.payment_method}>
                      <TableCell className="py-3 text-xs font-semibold text-slate-800">{row.payment_method}</TableCell>
                      <TableCell className="py-3 text-xs text-right text-gray-600">{row.payment_count}</TableCell>
                      <TableCell className="py-3 text-xs text-right font-bold text-slate-900">₱{parseFloat(row.total).toFixed(2)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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
      <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
        <CardHeader className="border-b border-gray-100 py-4 px-6">
          <CardTitle className="text-sm font-bold text-slate-800 flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-[#769046]" />
            <span>Roles &amp; Their Assigned Permissions</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50/80">
              <TableRow>
                <TableHead className="text-[10px] font-bold uppercase py-3">Role</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Permissions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={2} className="text-center py-6 text-xs text-gray-400">Loading role matrix…</TableCell></TableRow>
              ) : (
                roles.map((role) => (
                  <TableRow key={role.id} className="align-top">
                    <TableCell className="py-3 font-bold text-xs text-slate-900 whitespace-nowrap">{role.name}</TableCell>
                    <TableCell className="py-3">
                      <div className="flex flex-wrap gap-1 max-w-2xl">
                        {(rolePermissions[role.name] || []).length > 0 ? (
                          (rolePermissions[role.name] || []).map((permName) => (
                            <Badge key={permName} variant="outline" className="text-[10px] font-semibold border-gray-200">{permName}</Badge>
                          ))
                        ) : (
                          <span className="text-[11px] text-gray-400 italic">No permissions assigned</span>
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
      <p className="text-[11px] text-gray-400 px-1">Read-only. Editing role permissions is a SuperAdmin-only capability under Super Admin Management.</p>
    </div>
  );
};

// Module 12 originally built this page's "Today's Snapshot" as an honest, minimal entry point
// and explicitly deferred historical trends, date-range filtering, and the RBAC matrix report
// to this module. That live snapshot logic is unchanged here — only added to, not replaced.
const ReportsOverview = () => {
  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs space-y-1">
        <h2 className="text-xl font-bold text-slate-900 m-0">Clinic Reports</h2>
        <p className="text-xs text-gray-500 m-0">Live activity, historical trends, and clinic-wide metrics for Admin/SuperAdmin oversight.</p>
      </div>

      <Tabs defaultValue="snapshot" className="w-full space-y-4">
        <TabsList className="bg-gray-100 p-1 rounded-xl">
          <TabsTrigger value="snapshot" className="rounded-lg text-xs font-bold px-4 py-1.5">Today's Snapshot</TabsTrigger>
          <TabsTrigger value="range" className="rounded-lg text-xs font-bold px-4 py-1.5">Date-Range Reports</TabsTrigger>
          <TabsTrigger value="rbac" className="rounded-lg text-xs font-bold px-4 py-1.5">RBAC Matrix</TabsTrigger>
        </TabsList>
        <TabsContent value="snapshot" className="m-0">
          <TodaySnapshot />
        </TabsContent>
        <TabsContent value="range" className="m-0">
          <DateRangeReports />
        </TabsContent>
        <TabsContent value="rbac" className="m-0">
          <RbacMatrixReport />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ReportsOverview;
