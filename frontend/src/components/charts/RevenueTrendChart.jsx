import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCurrency } from '../../lib/currency';

// paid_at::date comes back from pg as a native Date; over JSON that serializes to a full ISO
// datetime string. `new Date(day)` alone parses either that or a bare YYYY-MM-DD.
const formatDay = (day) => new Date(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const compactCurrency = (value) => (
  value >= 1000 ? `₱${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : `₱${value}`
);

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-[#e6ebf1] rounded-lg shadow-float px-3 py-2 text-xs">
      <p className="font-bold text-slate-900 m-0">{formatDay(label)}</p>
      <p className="text-brand-600 font-semibold m-0">{formatCurrency(payload[0].value)}</p>
    </div>
  );
};

// Single-series line/area — one hue (brand green), no legend needed since the card title
// already names the series. Replaces the hand-rolled div-bar chart previously duplicated
// across ReportsOverview.jsx and AdminDashboard.jsx.
const RevenueTrendChart = ({ data }) => {
  const chartData = data.map((row) => ({ day: row.day, total: parseFloat(row.total) }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#53843b" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#53843b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis
          dataKey="day"
          tickFormatter={formatDay}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          axisLine={{ stroke: '#e5e7eb' }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={compactCurrency}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#53843b', strokeWidth: 1, strokeDasharray: '3 3' }} />
        <Area
          type="monotone"
          dataKey="total"
          stroke="#53843b"
          strokeWidth={2}
          fill="url(#revenueTrendFill)"
          dot={{ r: 3, fill: '#53843b', strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default RevenueTrendChart;
