import { useEffect, useRef } from 'react';

/**
 * Re-runs `callback` on an interval, so a screen showing live clinic state stays live.
 *
 * Every queue in this app fetched once on mount and then never again. A receptionist who opened
 * the Active Queue at 08:00 saw the 08:00 queue for the rest of the shift: walk-ins registered at
 * the other terminal never appeared, tickets paid by the cashier never moved, and the unread
 * notification dot never lit up on its own. The wait badges were the worst of it — they compute
 * "12m waiting" at render time, so with no re-render a ticket read 12m an hour later, and that
 * number is the one staff use to decide who to call next.
 *
 * Two behaviours worth knowing:
 *
 *   - Polling pauses while the tab is hidden. Clinic workstations sit locked or on another tab
 *     for long stretches, and there is no point spending requests on a screen nobody is looking
 *     at. (The dev rate limiter allows 20,000 per 15 minutes; three screens at 30s is roughly 120
 *     requests an hour per person, comfortably inside it, but idle tabs would still be waste.)
 *   - Returning to the tab refetches immediately rather than waiting out the remaining interval,
 *     so the first thing someone sees after unlocking is current rather than up to 30s stale.
 *
 * The callback is held in a ref so an inline arrow function does not restart the timer on every
 * render, while still never calling a stale closure.
 *
 * @param {() => void} callback     what to re-run; may be async, errors are the caller's business
 * @param {number}     intervalMs   how often, when the tab is visible
 * @param {{enabled?: boolean}} options  set enabled false to suspend (e.g. a modal is open)
 */
export function usePolling(callback, intervalMs = 30000, { enabled = true } = {}) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || !intervalMs) return undefined;

    const id = setInterval(() => {
      if (!document.hidden) savedCallback.current();
    }, intervalMs);

    const onVisibilityChange = () => {
      if (!document.hidden) savedCallback.current();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled]);
}

export default usePolling;
