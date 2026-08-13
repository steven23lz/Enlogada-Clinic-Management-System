import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// Fixed order, never reassigned when the category list changes: brand green first (the
// "self"/primary metric), then a chart-only blue (navy fails the categorical-mark lightness
// check — see VISUAL_IDENTITY.md §3a #15), then amber/emerald which are already used as
// MetricCard tones elsewhere. Indigo is deliberately excluded — status-badge.jsx already
// reserves it for "Processing" (§3a #10).
const CATEGORY_COLORS = ['#769046', '#2563eb', '#d97706', '#059669'];

const ChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  return (
    <div className="bg-white border border-gray-100 rounded-lg shadow-md px-3 py-2 text-xs">
      <p className="font-bold text-slate-900 m-0">{point.payload.category_name}</p>
      <p className="text-gray-600 m-0">{point.value} test{point.value === 1 ? '' : 's'}</p>
    </div>
  );
};

// Categorical horizontal bar — replaces the hand-rolled single-color (indigo) progress-bar
// list in ReportsOverview.jsx, giving each category its own color instead of one flat hue.
const CategoryVolumeChart = ({ data }) => {
  const chartData = data.map((row) => ({
    category_name: row.category_name,
    test_count: parseInt(row.test_count, 10),
  }));
  const height = Math.max(140, chartData.length * 44);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }} barCategoryGap={14}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
        <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="category_name"
          tick={{ fontSize: 11, fontWeight: 600, fill: '#475569' }}
          axisLine={false}
          tickLine={false}
          width={90}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
        <Bar dataKey="test_count" radius={[0, 6, 6, 0]} maxBarSize={22}>
          {chartData.map((entry, index) => (
            <Cell key={entry.category_name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

export default CategoryVolumeChart;
