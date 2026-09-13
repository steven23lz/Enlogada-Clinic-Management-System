import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../config/api';
import { todayStr, daysAgoStr } from '../lib/date';

/**
 * The per-department operating metrics for a date range. [1.22.0]
 *
 * One request, whatever the screen needs — the endpoint returns the union of the slices the
 * caller is permitted to see (billing / reception / diagnostics), so a cashier's screen and the
 * Admin roll-up call exactly the same thing and simply render different parts of it. Three
 * endpoints would mean the roll-up firing three requests to build one page, and three chances for
 * the figures on it to have come from different moments.
 *
 * Dates come from lib/date, never toISOString: that returns the UTC date, which in Philippine
 * time is yesterday between midnight and 08:00 — silently, with no error. See CLAUDE.md.
 */
export function useOperationsReport({ days = 7, enabled = true } = {}) {
  const [range, setRange] = useState({ startDate: daysAgoStr(days - 1), endDate: todayStr() });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  // Only the newest request may write. Two ranges asked for in quick succession can answer in
  // either order, and the figures on screen must be for the dates on screen.
  const latest = useRef(0);

  const fetchReport = useCallback(async (startDate, endDate) => {
    const id = ++latest.current;
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/reports/operations', { params: { startDate, endDate } });
      if (id !== latest.current) return;
      setReport(res.data.data.report);
    } catch (err) {
      if (id !== latest.current) return;
      // A 403 here is not a fault — it means this account holds none of the three permissions the
      // report covers, which the caller should be able to distinguish from a failure.
      setError(
        err.response?.status === 403
          ? 'forbidden'
          : err.response?.data?.message || 'Could not load the operating figures.'
      );
      setReport(null);
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, []);

  /**
   * Load a given range now, for a screen whose dates are chosen somewhere else — the cashier's
   * receipt list. [1.74.0] Always fetches, even the range already shown, so that screen's Apply
   * doubles as a refresh. Pair it with `enabled: false`, or the effect below fetches it twice.
   */
  const load = useCallback((startDate, endDate) => {
    setRange({ startDate, endDate });
    return fetchReport(startDate, endDate);
  }, [fetchReport]);

  useEffect(() => {
    if (!enabled) return;
    fetchReport(range.startDate, range.endDate);
  }, [enabled, fetchReport, range.startDate, range.endDate]);

  return {
    report,
    loading,
    error,
    range,
    setRange,
    load,
    refresh: () => fetchReport(range.startDate, range.endDate),
  };
}

export default useOperationsReport;
