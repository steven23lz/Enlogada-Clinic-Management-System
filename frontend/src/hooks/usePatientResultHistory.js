import { useState, useCallback } from 'react';
import api from '../config/api';

/** How many prior reports are worth showing beside a findings form before it becomes noise. */
const CONTEXT_LIMIT = 5;

/**
 * This patient's previous results, as context while writing new findings.
 *
 * `GET /results/history/:patientId` already existed and nothing on the diagnostic screen called
 * it [Phase C finding 02] — a technician wrote each report as though the patient had never been
 * seen before, which for a repeat CBC or a follow-up X-ray is exactly the wrong assumption.
 *
 * The test being reported on is excluded. Its own findings are in the form directly above;
 * repeating them as "history" would suggest a prior visit that did not happen.
 *
 * A failure is swallowed to an empty list. This is supporting context beside a form someone is
 * mid-way through filling in, and an error banner there would interrupt the actual work to
 * report that an optional convenience is missing.
 */
export function usePatientResultHistory() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadFor = useCallback(async (patientId, excludeVisitTestId) => {
    if (!patientId) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get(`/results/history/${patientId}`);
      const rows = (res.data.data.results || [])
        .filter((r) => r.result_id && r.visit_test_id !== excludeVisitTestId)
        .slice(0, CONTEXT_LIMIT);
      setResults(rows);
    } catch (err) {
      console.error('Failed to fetch patient result history:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { results, loading, loadFor };
}

export default usePatientResultHistory;
