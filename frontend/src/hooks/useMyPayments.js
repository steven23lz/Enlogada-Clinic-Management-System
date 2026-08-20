import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';

/**
 * A patient's own payment records.
 *
 * Separate from `useMyAppointments` even though the two refresh together after a gateway
 * return: this is the record of what was paid, and that is the list of what is booked. A
 * cancelled booking still has a receipt against it.
 */
export function useMyPayments() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/payments/my-payments');
      setPayments(response.data.data.payments || []);
    } catch (err) {
      console.error('Failed to fetch payment history:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { payments, loading, page, setPage, reload: load };
}

export default useMyPayments;
