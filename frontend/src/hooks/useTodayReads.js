import { useCallback, useEffect, useRef, useState } from 'react';
import { usePolling } from './usePolling';

/**
 * Today's reads, each loaded on its own. [1.77.0]
 *
 * Today draws on up to ten endpoints, and one failing must not blank the rest: a Promise.all would
 * turn a refused online-payments list into a screen with no queue either. So every read settles by
 * itself and carries its own `failed`, and the screen says WHICH ones it could not load. [1.74.0]
 *
 * `fetchers` maps a name to a function returning a promise, or to something falsy for a read this
 * person may not make — a Cashier asks for no bookings. A falsy entry is never fetched and never
 * fails: a figure somebody may not see is absent, not an error.
 *
 * `updatedAt` stamps only a pass in which every read succeeded. A screen that has just failed to
 * reload is showing older data than the clock would claim. [1.58.0]
 *
 * Polled once a minute (paused while the tab is hidden, via usePolling), and through the same URLs
 * the work screens poll, so an unchanged answer is a 0-byte 304 from the revalidation cache.
 *
 * @param {Record<string, (() => Promise<any>) | false | null | undefined>} fetchers
 */
export function useTodayReads(fetchers, { interval = 60000 } = {}) {
  const signature = Object.keys(fetchers).filter((key) => typeof fetchers[key] === 'function').join('|');
  // The functions are recreated every render; which reads exist is what decides a reload.
  const fetchersRef = useRef(fetchers);
  useEffect(() => {
    fetchersRef.current = fetchers;
  });

  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(Boolean(signature));
  // Every read has answered at least once. `loading` flips on each poll; this does not, so a list
  // that is quiet does not flash a skeleton once a minute.
  const [ready, setReady] = useState(!signature);
  const [updatedAt, setUpdatedAt] = useState(null);
  // Only the newest pass may write: a slow answer from the last poll must not overwrite a newer one.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const keys = signature ? signature.split('|') : [];
    const id = ++latest.current;
    if (!keys.length) {
      setLoading(false);
      setReady(true);
      return;
    }
    setLoading(true);
    const outcomes = await Promise.allSettled(keys.map((key) => fetchersRef.current[key]()));
    if (id !== latest.current) return;

    const next = {};
    outcomes.forEach((outcome, i) => {
      if (outcome.status === 'rejected') console.error(`Today could not load ${keys[i]}:`, outcome.reason);
      next[keys[i]] = outcome.status === 'fulfilled'
        ? { data: outcome.value, failed: false }
        : { data: undefined, failed: true };
    });
    setResults(next);
    if (outcomes.every((o) => o.status === 'fulfilled')) setUpdatedAt(new Date());
    setLoading(false);
    setReady(true);
  }, [signature]);

  useEffect(() => {
    load();
  }, [load]);

  usePolling(load, interval, { enabled: Boolean(signature) });

  /** One read: `data` once it has answered, `failed` if it did not, `loading` until its first answer. */
  const read = useCallback((key) => {
    const entry = results[key];
    const wanted = signature.split('|').includes(key);
    return { data: entry?.data, failed: Boolean(entry?.failed), loading: wanted && !entry };
  }, [results, signature]);

  return { read, loading, ready, updatedAt, reload: load };
}

export default useTodayReads;
