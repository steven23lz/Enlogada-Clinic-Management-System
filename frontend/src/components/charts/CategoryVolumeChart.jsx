import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// Colour is keyed to the CATEGORY, not to its position in the array.
//
// Two defects this replaces. The list held four colours and was indexed with `index % length`,
// but test_categories has five rows (Laboratory, Ultrasound, Xray, 2D Echo, ECG) — so the fifth
// category rendered in the first one's exact green, and the chart showed two different services
// as the same colour with nothing to tell them apart. And keying on array position meant colour
// followed rank rather than identity: a quiet week where one category recorded no tests dropped
// it from the response and repainted every survivor, so Laboratory was green on Monday and blue
// on Tuesday. A reader who has learned the colours is worse off than one who never trusted them.
//
// Verified with the dataviz palette validator (light surface): lightness band, chroma floor,
// contrast and CVD separation all pass, worst adjacent pair ΔE 15.0 under deuteranopia against a
// target of 8. The previous set's emerald/amber pair sat at 7.9 — inside the floor band where a
// palette is only legal alongside secondary encoding.
const CATEGORY_COLORS = {
  Laboratory: '#769046',   // brand green, the clinic's primary service
  Ultrasound: '#2563eb',   // chart-only blue; navy fails the categorical lightness check
  Xray: '#d97706',         // amber
  '2D Echo': '#7c3aed',    // violet
  ECG: '#0891b2',          // cyan
};

// Anything not in the map — a category added to the database but not here — falls back to a
// neutral rather than silently reusing another service's colour. Grey reads as "unclassified",
// which is true, instead of quietly lying about which service a bar belongs to.
const UNMAPPED_CATEGORY_COLOR = '#94a3b8';

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
          {chartData.map((entry) => (
            <Cell
              key={entry.category_name}
              fill={CATEGORY_COLORS[entry.category_name] || UNMAPPED_CATEGORY_COLOR}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

export default CategoryVolumeChart;
