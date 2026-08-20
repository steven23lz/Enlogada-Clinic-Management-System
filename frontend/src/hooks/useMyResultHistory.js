import { useState, useCallback, useEffect, useMemo } from 'react';
import api from '../config/api';

/**
 * One patient's diagnostic history, with the filters the portal puts over it.
 *
 * Keyed on `patientId` rather than fetched once, because an account owns several profiles and
 * switching between them must change what is shown. Passing null empties the list — that is what
 * "no profile selected" looks like, and it is deliberately not the same as "this patient has no
 * results", which the caller renders differently.
 */
export function useMyResultHistory({ patientId } = {}) {
  const [history, setHistory] = useState([]);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');

  const load = useCallback(async (id) => {
    if (!id) {
      setHistory([]);
      return;
    }
    try {
      const response = await api.get(`/results/history/${id}`);
      setHistory(response.data.data.results);
    } catch (err) {
      console.error('Failed to fetch diagnostic history:', err);
    }
  }, []);

  useEffect(() => {
    load(patientId);
  }, [patientId, load]);

  const filtered = useMemo(() => history.filter((item) => {
    const matchesCategory = category === 'All' || item.category_name === category;
    const matchesSearch = !search
      || item.test_name.toLowerCase().includes(search.toLowerCase())
      || item.category_name.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  }), [history, category, search]);

  // Counted over the WHOLE history, not the filtered view: these are tiles describing the
  // patient's record, and a search box narrowing them would make them read as the record itself
  // shrinking.
  const pendingCount = useMemo(
    () => history.filter((h) => h.test_status === 'Pending' || h.test_status === 'Processing').length,
    [history]
  );
  const completedCount = useMemo(
    () => history.filter((h) => h.test_status === 'Completed').length,
    [history]
  );

  return {
    history, filtered,
    category, setCategory,
    search, setSearch,
    pendingCount, completedCount,
    reload: () => load(patientId),
  };
}

export default useMyResultHistory;
