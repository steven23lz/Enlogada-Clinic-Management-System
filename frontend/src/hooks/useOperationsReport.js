import { useCallback, useEffect, useState } from 'react';
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

  const fetchReport = useCallback(async (startDate, endDate) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/reports/operations', { params: { startDate, endDate } });
      setReport(res.data.data.report);
    } catch (err) {
      // A 403 here is not a fault — it means this account holds none of the three permissions the
      // report covers, which the caller should be able to distinguish from a failure.
      setError(
        err.response?.status === 403
          ? 'forbidden'
          : err.response?.data?.message || 'Could not load the operating figures.'
      );
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

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
    refresh: () => fetchReport(range.startDate, range.endDate),
  };
}

export default useOperationsReport;
