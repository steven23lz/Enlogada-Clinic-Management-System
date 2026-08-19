import { useState, useCallback, useEffect, useRef } from 'react';
import api from '../config/api';
import { usePolling } from './usePolling';

// Sent to the server as `limit`. Search, status filtering and paging all happen in the backend
// query [UI/UX Phase 2] — the queue genuinely reaches the hundreds on a busy day, and a
// client-side .filter() over every visit already downloaded does not survive that.
export const QUEUE_PAGE_SIZE = 25;

const SEARCH_DEBOUNCE_MS = 400;

/**
 * Who is waiting at reception right now — the list, its filters, its paging and its counts.
 *
 * The reception counterpart of `useBillingQueue`. Everything here describes one question, "who
 * is in front of us", and the three filters are held together because the server needs all three
 * on every request: changing the status while a search is typed must keep the search.
 *
 * That is what `refresh()` is for. Re-reading the queue *as it currently stands* appeared six
 * times on the page as `fetchActiveVisits({ page: queuePage, search: searchQuery, status:
 * statusFilter })` — once after each mutation that changes who is waiting. Six copies of a
 * three-part argument list is six chances to forget one and silently reset the receptionist's
 * filter under them.
 */
export function useReceptionQueue({ enabled = true } = {}) {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  // Recorded rather than only logged: a swallowed failure renders the EMPTY state, and "nobody
  // is waiting" over a broken request is a false statement about the clinic, not a missing one.
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [pendingCount, setPendingCount] = useState(0);
  const [processingCount, setProcessingCount] = useState(0);
  const [walkinCount, setWalkinCount] = useState(0);

  const debounceRef = useRef(null);

  /**
   * The one fetch. Every filter is passed explicitly rather than read from state, because the
   * callers that change a filter must fetch with the NEW value — state is not yet updated when
   * the handler runs.
   */
  const fetch = useCallback(async ({ page: nextPage = 1, search: term = '', status: state = 'All' } = {}) => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/visits/active', {
        params: {
          page: nextPage,
          limit: QUEUE_PAGE_SIZE,
          search: term || undefined,
          status: state && state !== 'All' ? state : undefined,
        },
      });
      const data = response.data.data;
      setVisits(data.visits || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
      setPendingCount(data.pendingCount || 0);
      setProcessingCount(data.processingCount || 0);
      setWalkinCount(data.walkinCount || 0);
      setPage(data.page || nextPage);
    } catch (err) {
      console.error('Failed to fetch active visits:', err);
      setError('Could not load the active queue. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch({ page: 1, search: '', status: 'All' });
  }, [fetch]);

  /** Re-read the queue exactly as the receptionist has it filtered and paged. */
  const refresh = useCallback(
    () => fetch({ page, search, status }),
    [fetch, page, search, status]
  );

  /**
   * Keep it live. Walk-ins registered at another terminal, tickets the cashier has just settled,
   * and the wait-time badges (which recompute on render) all go stale the moment the screen
   * loads — a receptionist who opened the queue at 08:00 saw the 08:00 queue all shift. Only
   * while the queue is actually on screen; paused automatically when the tab is hidden.
   */
  usePolling(refresh, 30000, { enabled });

  /**
   * Typing filters at the server, so it waits for a pause rather than firing per keystroke.
   * Always back to page 1: staying on page 3 of the old result set shows an empty table for a
   * search that matched plenty.
   */
  const onSearchChange = (value) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch({ page: 1, search: value, status });
    }, SEARCH_DEBOUNCE_MS);
  };

  // A pending keystroke must not fire a request after the screen is gone.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const onStatusChange = (value) => {
    setStatus(value);
    fetch({ page: 1, search, status: value });
  };

  const goToPage = (next) => {
    if (next < 1 || next > totalPages) return;
    fetch({ page: next, search, status });
  };

  return {
    visits, loading, error,
    search, status,
    page, total, totalPages,
    pendingCount, processingCount, walkinCount,
    refresh, onSearchChange, onStatusChange, goToPage,
  };
}

export default useReceptionQueue;
