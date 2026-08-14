import React from 'react';
import { Card, CardContent } from './card';
import { TrendingUp, TrendingDown } from 'lucide-react';

const ICON_TONE = {
  green: 'bg-[#769046]/12 text-[#769046]',
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  rose: 'bg-rose-100 text-rose-700',
  purple: 'bg-purple-100 text-purple-700',
  slate: 'bg-slate-100 text-slate-700',
};

// A saturated rule down the leading edge of each card. It does the job the pale icon chip was
// being asked to do alone: at the distance someone actually reads a KPI strip — across a
// reception desk, glancing up between patients — a small tinted square is not enough to group
// or distinguish cards, and the row reads as one undifferentiated band of white. A full-height
// bar registers peripherally, so "how many are waiting on me" resolves before you focus on any
// individual number. It also ties each card to the status badges below it, which use the same
// hues for the same meanings.
const ACCENT_TONE = {
  green: 'bg-[#769046]',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  indigo: 'bg-indigo-500',
  rose: 'bg-rose-500',
  purple: 'bg-purple-500',
  slate: 'bg-slate-400',
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
        {/* gray-500 rather than gray-400: at 10px uppercase this is the smallest text on the
            screen, and gray-400 on white falls below the WCAG AA contrast floor. */}
        <span className={`text-meta font-bold uppercase tracking-wider block ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{label}</span>
        {/* tabular-nums keeps digits on a fixed advance width, so figures line up across a row
            of cards and a counter ticking 9 -> 10 does not shift the layout under the reader. */}
        <div className={`text-stat leading-none font-extrabold tracking-tight tabular-nums break-words ${isDark ? (DARK_VALUE_TONE[tone] || 'text-white') : 'text-slate-900'}`}>
          {value}
        </div>
        {trend && (
          <div className={`flex items-center space-x-1 text-fine font-bold ${TREND_TONE[trend.direction]}`}>
            {trend.direction === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span>{trend.label}</span>
          </div>
        )}
        {caption && !trend && (
          <div className={`text-fine font-bold ${isDark ? 'text-gray-300' : (CAPTION_TONE[resolvedCaptionTone] || 'text-gray-400')}`}>
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
      className={`relative overflow-hidden border-gray-200/80 shadow-sm rounded-2xl bg-white ${clickable ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200' : ''} ${className}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${ACCENT_TONE[tone] || ACCENT_TONE.slate}`} />
      <CardContent className="p-5 pl-6">{body}</CardContent>
    </Card>
  );
};

export default MetricCard;
