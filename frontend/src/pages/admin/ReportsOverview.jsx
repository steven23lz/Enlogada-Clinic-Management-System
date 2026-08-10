import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../../components/ui/card';
import api from '../../config/api';
import { TrendingUp, TrendingDown, ClipboardList, FileText, Info } from 'lucide-react';

const dateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Module 12: "clinic-wide reporting entry point" — a real, minimal KPI landing page built
// entirely from data already fetched by other modules (no new backend). Full analytics,
// date-range exports, and charts are Module 17 (Reporting)'s explicit, separate scope.
const ReportsOverview = () => {
  const [todayTotal, setTodayTotal] = useState(0);
  const [yesterdayTotal, setYesterdayTotal] = useState(0);
  const [activeQueueCount, setActiveQueueCount] = useState(0);
  const [catalogCount, setCatalogCount] = useState(0);
  const [methodBreakdown, setMethodBreakdown] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchReportData = useCallback(async () => {
    setLoading(true);
    try {
      const today = dateStr(new Date());
      const yesterday = dateStr(new Date(Date.now() - 86400000));

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
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs space-y-1">
        <h2 className="text-xl font-bold text-slate-900 m-0">Clinic Reports</h2>
        <p className="text-xs text-gray-500 m-0">A live snapshot of today's activity. Full historical analytics and exportable reports are a planned future capability.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-5 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Today's Revenue</span>
          <div className="text-2xl font-extrabold text-slate-900">{loading ? '…' : `₱${todayTotal.toFixed(2)}`}</div>
          {!loading && (
            <div className={`flex items-center space-x-1 text-[11px] font-bold ${isUp ? 'text-emerald-600' : 'text-rose-600'}`}>
              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span>{isUp ? '+' : ''}{percentChange.toFixed(0)}% vs yesterday (₱{yesterdayTotal.toFixed(2)})</span>
            </div>
          )}
        </Card>

        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-5 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Active Queue</span>
          <div className="text-2xl font-extrabold text-slate-900">{loading ? '…' : activeQueueCount}</div>
          <div className="flex items-center space-x-1 text-[11px] text-indigo-600 font-bold">
            <ClipboardList className="w-3 h-3" />
            <span>Pending + Processing visits today</span>
          </div>
        </Card>

        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-5 space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Services Catalog</span>
          <div className="text-2xl font-extrabold text-slate-900">{loading ? '…' : catalogCount}</div>
          <div className="flex items-center space-x-1 text-[11px] text-[#769046] font-bold">
            <FileText className="w-3 h-3" />
            <span>Active diagnostic services</span>
          </div>
        </Card>

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
          This is a reporting <strong className="text-white">entry point</strong> — a live snapshot built from existing data. Historical trends, date-range filtering, exportable reports, and the RBAC matrix report are planned for a dedicated future module.
        </p>
      </div>
    </div>
  );
};

export default ReportsOverview;
