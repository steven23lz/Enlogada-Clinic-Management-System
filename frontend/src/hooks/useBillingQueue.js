import { useState, useCallback, useEffect, useMemo } from 'react';
import api from '../config/api';
import { usePolling } from './usePolling';

/**
 * Who is waiting to be billed — the cashier's queue, and today's takings beside it.
 *
 * The second of the four groups CashierDashboard was carrying in one component. It owns eight
 * pieces of state, three fetches, the polling, and the filtering — none of which the rest of the
 * screen has any business seeing.
 *
 * `transactions` lives here rather than beside the till because the queue depends on it: a visit
 * already paid today must drop off the list, and `paidVisitIds` is how that is decided. Keeping
 * the two together is what stops a paid ticket reappearing.
 *
 * `paused` suspends the polling, and the reason is worth keeping next to the code. A refetch
 * mid-checkout rewrites the list under the cashier's cursor, and since `paidVisitIds` is derived
 * from `transactions`, a refresh can pull the very row they are charging out from underneath
 * them. The caller passes the visit it has selected; nothing polls while one is open.
 */
export function useBillingQueue({ enabled = true, paused = false } = {}) {
  const [activeVisits, setActiveVisits] = useState([]);
  const [transactions, setTransactions] = useState([]);
  // The day's peso figures, aggregated in SQL over settled rows. `transactions` is the receipt
  // LOG and includes reversals, so it is not a thing to add up — see lib/collections.js.
  const [summary, setSummary] = useState(null);
  const [patientTypes, setPatientTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed fetch used to reach console.error and stop there, so the queue rendered its EMPTY
  // state over a 500 — "nobody is waiting" while the server was down.
  const [error, setError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [sortOrder, setSortOrder] = useState('oldest');

  const fetchActiveVisits = useCallback(async () => {
    try {
      const response = await api.get('/visits/active');
      setActiveVisits(response.data.data.visits || []);
      setError('');
    } catch (err) {
      console.error('Failed to fetch active visits:', err);
      setError('Could not load the billing queue. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      const response = await api.get('/payments/transactions');
      setTransactions(response.data.data.transactions || []);
      setSummary(response.data.data.summary || null);
    } catch (err) {
      console.error('Failed to fetch transaction logs:', err);
      setError("Could not load today's collections. Please try again.");
    }
  }, []);

  const fetchPatientTypes = useCallback(async () => {
    try {
      const res = await api.get('/patients/types');
      setPatientTypes(res.data.data.patientTypes || []);
    } catch (err) {
      console.error('Failed to fetch patient types:', err);
    }
  }, []);

  const refresh = useCallback(() => {
    fetchActiveVisits();
    fetchTransactions();
    fetchPatientTypes();
  }, [fetchActiveVisits, fetchTransactions, fetchPatientTypes]);

  useEffect(() => { refresh(); }, [refresh]);

  // Visits released by the front desk, and payments taken at a second terminal, were both
  // invisible here until the cashier happened to change a filter.
  usePolling(
    () => { fetchActiveVisits(); fetchTransactions(); },
    30000,
    { enabled: enabled && !paused }
  );

  /**
   * Visits already settled today. A paid ticket must not sit in a queue of people to charge.
   *
   * The 'Paid' filter is load-bearing, not defensive: the log now lists reversed receipts too,
   * and a refunded visit genuinely owes money again — so it should reappear here to be charged,
   * which is also what uq_payments_one_paid_per_visit allows by being partial on 'Paid'.
   */
  const paidVisitIds = useMemo(
    () => new Set(transactions.filter((t) => t.payment_status === 'Paid').map((t) => t.patient_visit_id)),
    [transactions]
  );

  /** What the screen actually renders: unpaid, matching the search and the type, in arrival order. */
  const visits = useMemo(() => activeVisits
    .filter((v) => {
      if (paidVisitIds.has(v.id)) return false;
      const matchesSearch = !searchQuery ||
        `${v.first_name} ${v.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (v.queue_number && v.queue_number.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesType = typeFilter === 'All' || v.patient_type_name === typeFilter;
      return matchesSearch && matchesType;
    })
    .sort((a, b) => {
      const diff = new Date(a.created_at) - new Date(b.created_at);
      return sortOrder === 'oldest' ? diff : -diff;
    }), [activeVisits, paidVisitIds, searchQuery, typeFilter, sortOrder]);

  return {
    visits, transactions, summary, patientTypes, paidVisitIds,
    loading, error,
    searchQuery, setSearchQuery,
    typeFilter, setTypeFilter,
    sortOrder, setSortOrder,
    /** Re-read everything — what the retry link and a completed payment both want. */
    refresh,
    /** Whether any filter is narrowing the list, so the screen can tell empty from filtered-out. */
    isFiltered: Boolean(searchQuery) || typeFilter !== 'All',
  };
}
