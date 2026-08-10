import React from 'react';
import { Card, CardContent } from './card';
import { TrendingUp, TrendingDown } from 'lucide-react';

const ICON_TONE = {
  green: 'bg-[#769046]/10 text-[#769046]',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  rose: 'bg-rose-50 text-rose-600',
  purple: 'bg-purple-50 text-purple-600',
  slate: 'bg-slate-100 text-slate-700',
};

const CAPTION_TONE = {
  green: 'text-[#769046]',
  emerald: 'text-emerald-600',
  amber: 'text-amber-600',
  indigo: 'text-indigo-600',
  rose: 'text-rose-600',
  purple: 'text-purple-600',
  slate: 'text-gray-400',
};

const DARK_VALUE_TONE = {
  green: 'text-[#769046]',
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  indigo: 'text-indigo-400',
  rose: 'text-rose-400',
  purple: 'text-purple-300',
  slate: 'text-white',
};

const TREND_TONE = {
  up: 'text-emerald-600',
  down: 'text-rose-600',
};

// Shared metric/KPI card, used across every dashboard (Admin, Reports, Receptionist, Cashier,
// Diagnostic Staff, Client). Before this component, each dashboard hand-rolled its own version
// — four visually distinct shapes (different icon sizes, some with colored value text, some
// without an icon at all) with no shared source, per the UI/UX audit. `variant="dark"`
// preserves Client's hero-banner tile treatment (which sits on a dark background the other
// five surfaces never use) rather than forcing one visual world onto both contexts.
const MetricCard = ({ label, value, icon: Icon, tone = 'green', captionTone, caption, trend, variant = 'light', onClick, className = '' }) => {
  const resolvedCaptionTone = captionTone || tone;
  const isDark = variant === 'dark';
  const clickable = typeof onClick === 'function';
  const iconSizeClass = isDark ? 'w-9 h-9 rounded-xl' : 'w-11 h-11 rounded-2xl';

  const body = (
    <div className="flex items-center justify-between">
      <div className="space-y-1 min-w-0">
        <span className="text-[10px] font-bold uppercase tracking-wider block text-gray-400">{label}</span>
        <div className={`text-2xl font-extrabold break-words ${isDark ? (DARK_VALUE_TONE[tone] || 'text-white') : 'text-slate-900'}`}>
          {value}
        </div>
        {trend && (
          <div className={`flex items-center space-x-1 text-[11px] font-bold ${TREND_TONE[trend.direction]}`}>
            {trend.direction === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span>{trend.label}</span>
          </div>
        )}
        {caption && !trend && (
          <div className={`text-[11px] font-bold ${isDark ? 'text-gray-300' : (CAPTION_TONE[resolvedCaptionTone] || 'text-gray-400')}`}>
            {caption}
          </div>
        )}
      </div>
      {Icon && (
        <div className={`${iconSizeClass} flex items-center justify-center flex-shrink-0 ${isDark ? 'bg-white/10 text-white' : (ICON_TONE[tone] || ICON_TONE.slate)}`}>
          <Icon className="w-5 h-5" />
        </div>
      )}
    </div>
  );

  if (isDark) {
    return (
      <div
        onClick={onClick}
        className={`bg-slate-800/80 rounded-2xl p-3.5 border border-slate-700/60 ${clickable ? 'cursor-pointer hover:bg-slate-800 transition-colors' : ''} ${className}`}
      >
        {body}
      </div>
    );
  }

  return (
    <Card
      onClick={onClick}
      className={`border-gray-100 shadow-xs rounded-2xl bg-white ${clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} ${className}`}
    >
      <CardContent className="p-5">{body}</CardContent>
    </Card>
  );
};

export default MetricCard;
