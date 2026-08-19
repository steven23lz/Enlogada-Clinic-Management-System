import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';
import { todayStr } from '../lib/date';

// Sent to the server as `limit` — this list pages at the database [1.29.0] rather than fetching
// the whole date range and slicing it in the browser.
export const HISTORY_PAGE_SIZE = 15;

/**
 * The receipts a cashier issued, over a chosen range — state, fetching and paging as one thing.
 *
 * ── Why a hook and not a class ───────────────────────────────────────────────────────────────
 * This is the "object" the four dashboards were asking for. CashierDashboard held 38 separate
 * pieces of state in one component, in four groups that never touch each other — the queue, this
 * history, the refund, and the till. Read top to bottom, the file was 38 unrelated `useState`
 * lines and then, hundreds of lines later, the handlers that act on them.
 *
 * A hook is React's unit of encapsulation: state plus the behaviour that owns it, behind one
 * named interface, testable and reusable on its own. A class component cannot do this job — it
 * cannot call hooks at all, so `usePolling`, `useAuth` and `useOperationsReport` would have to be
 * rewritten or wrapped, and the dashboards would become the only classes in a codebase of forty
 * function components. The one class here (ErrorBoundary) exists because React offers no hook for
 * error boundaries, which is the exception that shows the rule.
 *
 * `enabled` is what makes the history lazy: the caller passes false until the tab is opened, and
 * the first load fires once and only once. That belonged in the component as a `historyLoaded`
 * boolean and an effect keyed on the view — a piece of bookkeeping the screen had to remember to
 * do, which is exactly the kind of thing that belongs behind an interface rather than in a page.
 */
export function useTransactionHistory({ enabled = false } = {}) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Paged at the server, not here. [1.29.0] This used to pull every settled payment in the range
  // and slice fifteen out of it in the browser. Measured at 570 bytes a payment, a year-wide
  // range is a 2.0 MB response to fill a fifteen-row table — on the screen a cashier opens for
  // the daily cash-up.
  const fetch = useCallback(async (from, to, nextPage = 1) => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/payments/transactions', {
        params: { startDate: from, endDate: to, page: nextPage, limit: HISTORY_PAGE_SIZE },
      });
      const { transactions: rows, total: count, totalPages: pages } = response.data.data;
      setTransactions(rows || []);
      setTotal(count ?? (rows || []).length);
      setTotalPages(pages || 1);
      setPage(nextPage);
    } catch (err) {
      console.error('Failed to fetch transaction history:', err);
      setError('Could not load transaction history. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Lazy: nothing is fetched until the screen that shows it is actually open.
  useEffect(() => {
    if (enabled && !loadedOnce) {
      setLoadedOnce(true);
      fetch(startDate, endDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    transactions, loading, error,
    startDate, setStartDate,
    endDate, setEndDate,
    page, total, totalPages,
    /** Re-run for the dates currently chosen — what the Apply button and the retry link do. */
    reload: () => fetch(startDate, endDate),
    /** Jump to a page, keeping the chosen range. */
    goToPage: (next) => fetch(startDate, endDate, next),
  };
}
