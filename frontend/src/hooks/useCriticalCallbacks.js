import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';
import { usePolling } from './usePolling';
import { toastSuccess, toastError } from '../lib/toast';

/**
 * Released critical results still waiting on their phone call, and recording that call.
 *
 * Deliberately NOT department-scoped by the API: a potassium of 7.4 belongs to whoever can act
 * on it, not to the room that produced it. Every diagnostic console shows the same list and
 * whoever reaches it first records the call.
 *
 * Polled rather than fetched once, because the entire point of the tile is that a panic value
 * raised by another department AFTER this screen was opened still reaches somebody.
 *
 * Three decisions worth keeping:
 *
 * A failure is REPORTED, not swallowed. It used to be caught and turned into an empty list, so a
 * failed request read "0 — nothing outstanding": the most confident possible way to be wrong about
 * a panic value. The list that last loaded is kept (still true, only older) and `error` says the
 * refresh failed, so the tile can say "couldn't check" instead of "nothing". [1.74.0]
 *
 * There is an explicit initial fetch, because `usePolling` only sets an interval and does not
 * fire on mount. Without it the tile read "0 — nothing outstanding" for the first thirty seconds
 * of every visit to the screen.
 *
 * Recording the call was never built. [1.74.0] The route and its audit entry existed since
 * [1.15.0], and the dialog told staff to "record the call", but nothing on screen called it, so a
 * callback could be counted and never cleared. A 409 means someone else recorded it first, which
 * is the outcome everyone wanted, so it is reported as done rather than as an error.
 *
 * @param {boolean} enabled  only where it can be acted on
 * @param {boolean} paused   suspended behind an open dialog, like the worklist beneath it
 */
export function useCriticalCallbacks({ enabled = true, paused = false } = {}) {
  const [outstanding, setOutstanding] = useState([]);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  // Which call is being saved, so only that row's button spins.
  const [recordingId, setRecordingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/results/critical/outstanding');
      setOutstanding(res.data.data.outstanding || []);
      setError('');
    } catch (err) {
      console.error('Failed to fetch outstanding critical results:', err);
      setError('Could not check for critical results. Please try again.');
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  usePolling(load, 30000, { enabled: enabled && !paused });

  /**
   * Record that the patient (or their doctor) was told. Resolves true once the call is on record,
   * whoever recorded it, so the caller can clear the note it was holding.
   */
  const record = useCallback(async (item, note = '') => {
    const name = `${item.first_name} ${item.last_name}`;
    const trimmed = note.trim();
    setRecordingId(item.visit_test_id);
    try {
      await api.post(`/results/${item.visit_test_id}/acknowledge-critical`, trimmed ? { note: trimmed } : {});
      toastSuccess(`Call recorded for ${name}`, item.test_name);
      await load();
      return true;
    } catch (err) {
      if (err.response?.status === 409) {
        toastSuccess(`${name}'s call is already on record`, 'Someone else recorded it first.');
        await load();
        return true;
      }
      toastError(`Could not record the call for ${name}`, err.response?.data?.message || 'Please try again.');
      return false;
    } finally {
      setRecordingId(null);
    }
  }, [load]);

  return { outstanding, error, expanded, setExpanded, recordingId, record, reload: load };
}

export default useCriticalCallbacks;
