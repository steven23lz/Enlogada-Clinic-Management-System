import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';
import { usePolling } from './usePolling';

/**
 * Released critical results still waiting on their phone call.
 *
 * Deliberately NOT department-scoped by the API: a potassium of 7.4 belongs to whoever can act
 * on it, not to the room that produced it. Every diagnostic console shows the same list and
 * whoever reaches it first records the call.
 *
 * Polled rather than fetched once, because the entire point of the tile is that a panic value
 * raised by another department AFTER this screen was opened still reaches somebody.
 *
 * Two decisions worth keeping:
 *
 * Failure is swallowed to an empty list. A red banner across a worklist because a secondary
 * counter could not load would be worse than the counter being briefly stale.
 *
 * There is an explicit initial fetch, because `usePolling` only sets an interval and does not
 * fire on mount. Without it the tile read "0 — nothing outstanding" for the first thirty seconds
 * of every visit to the screen, which is the most confident possible way to be wrong about a
 * panic value.
 *
 * @param {boolean} enabled  only where it can be acted on
 * @param {boolean} paused   suspended behind an open dialog, like the worklist beneath it
 */
export function useCriticalCallbacks({ enabled = true, paused = false } = {}) {
  const [outstanding, setOutstanding] = useState([]);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/results/critical/outstanding');
      setOutstanding(res.data.data.outstanding || []);
    } catch {
      setOutstanding([]);
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  usePolling(load, 30000, { enabled: enabled && !paused });

  return { outstanding, expanded, setExpanded, reload: load };
}

export default useCriticalCallbacks;
