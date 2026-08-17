import React, { useMemo, useState } from 'react';
import { SearchInput } from '../ui/search-input';
import { formatCurrency } from '../../lib/currency';
import { AlertTriangle } from 'lucide-react';

/**
 * Choosing which tests a visit is for. [1.26.0]
 *
 * Extracted so the front desk and the queue use the same control, and so registering a walk-in
 * can attach tests in the same breath. Reception used to register the patient on one screen, then
 * find that patient again in the queue to attach anything — two screens for one interaction, at
 * the busiest moment of the clinic's day, with a real chance of the second half never happening.
 * A visit with no tests reaches the cashier as a zero bill.
 *
 * ── Three things it does that a bare checkbox list does not ───────────────────────────────────
 * It shows a running total, so reception can answer "how much will this be?" at the desk instead
 * of the patient finding out at the till. It groups by department, because a catalogue of fifteen
 * tests in arbitrary order is a scan every single time. And it surfaces the preparation note for
 * anything selected, so the person handing over the queue ticket is the one who says "come back
 * fasting" — which is far more likely to land than an email.
 */
const TestPicker = ({
  tests = [],
  selectedIds = [],
  onToggle,
  disabled = false,
  maxHeight = 'max-h-56',
}) => {
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matching = term
      ? tests.filter((t) => `${t.name} ${t.category_name}`.toLowerCase().includes(term))
      : tests;

    const byCategory = new Map();
    for (const t of matching) {
      const key = t.category_name || 'Other';
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(t);
    }
    return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tests, query]);

  const selected = tests.filter((t) => selectedIds.includes(t.id.toString()));
  const total = selected.reduce((sum, t) => sum + parseFloat(t.price || 0), 0);
  const preparation = selected.filter((t) => t.preparation);

  return (
    <div className="space-y-2">
      {/* Only once the catalogue is long enough that scanning it is work. */}
      {tests.length > 8 && (
        <SearchInput
          placeholder="Filter tests…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
        />
      )}

      <div className={`${maxHeight} space-y-3 overflow-y-auto rounded-xl border border-[#e6ebf1] bg-slate-50/70 p-3`}>
        {grouped.length === 0 ? (
          <p className="m-0 py-3 text-center text-fine text-slate-400">No test matches that.</p>
        ) : (
          grouped.map(([category, items]) => (
            <div key={category} className="space-y-1">
              <p className="m-0 px-1 text-micro font-semibold uppercase tracking-[0.08em] text-slate-500">
                {category}
              </p>
              {items.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#e6ebf1] bg-white p-2 text-xs transition-colors hover:border-brand-300"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(t.id.toString())}
                    onChange={() => onToggle(t.id.toString())}
                    disabled={disabled}
                    className="rounded text-brand-600 focus:ring-brand-500"
                  />
                  <span className="flex flex-1 items-center justify-between gap-2">
                    <span className="font-bold text-slate-800">{t.name}</span>
                    <span className="font-extrabold tabular-nums text-slate-900">{formatCurrency(t.price)}</span>
                  </span>
                </label>
              ))}
            </div>
          ))
        )}
      </div>

      {/* The running total. Reception can quote it across the desk rather than the patient
          discovering the number at the till. */}
      <div className="flex items-center justify-between rounded-lg bg-sunken px-3 py-2">
        <span className="text-fine font-medium text-slate-500">
          {selected.length === 0
            ? 'No tests selected'
            : `${selected.length} test${selected.length === 1 ? '' : 's'} selected`}
        </span>
        <span className="text-[13px] font-extrabold tabular-nums text-slate-900">{formatCurrency(total)}</span>
      </div>

      {/* Preparation, at the desk. The person handing over the queue ticket saying "come back
          fasting" lands far better than the same sentence in an email. */}
      {preparation.length > 0 && (
        <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-inset ring-amber-200">
          <p className="m-0 flex items-center gap-1.5 text-fine font-semibold text-amber-900">
            <AlertTriangle className="h-3 w-3 flex-shrink-0" />
            Tell the patient before they leave
          </p>
          <ul className="m-0 list-disc space-y-0.5 pl-5 text-fine leading-relaxed text-amber-800">
            {preparation.map((t) => (
              <li key={t.id}><strong>{t.name}</strong> — {t.preparation}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default TestPicker;
