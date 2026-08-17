/**
 * An in-memory ETag cache, so a poll that changes nothing costs almost nothing. [1.26.0]
 *
 * ── The problem, measured ─────────────────────────────────────────────────────────────────────
 * Four screens poll to stay live, and they are right to: a queue that only loads once shows the
 * 08:00 queue all shift. But a single idle staff browser makes 240 requests an hour — the queue
 * every 30s, notifications and /auth/me every 60s each — and pulls about 1.5 MB with it. Ten
 * staff over a 26-day month is roughly 500,000 requests and 3.2 GB of egress, almost all of it
 * re-sending bytes the browser already has. On metered hosting that is a line on the bill for no
 * information.
 *
 * The server already solves this: Express emits an ETag on every JSON response and answers a
 * matching `If-None-Match` with a 0-byte 304. Verified with a raw request before this was built.
 * Nothing was asking.
 *
 * ── Why in memory rather than Cache-Control ───────────────────────────────────────────────────
 * The conventional fix is `Cache-Control: private, no-cache`, which makes the browser store the
 * response and revalidate it. It also writes every one of those responses — active patient
 * queues, result histories, notification text naming patients — into the browser's on-disk HTTP
 * cache, where it outlives the session and the logout. For a clinic that is a poor trade for a
 * bandwidth saving.
 *
 * Holding the validators here instead keeps the whole thing in the tab's memory: gone on refresh,
 * gone on logout, never touched by the disk cache, and not shared between two accounts using the
 * same machine — which the URL-keyed browser cache would happily do.
 *
 * ── Bounded, because a cache that only grows is a leak ────────────────────────────────────────
 * Keyed by method+URL, capped, and evicted oldest-first. A reception terminal left open all day
 * paging through visit history would otherwise accumulate an entry per distinct query string.
 */

// Roughly the number of distinct GET URLs a long shift produces, with headroom. Each entry is one
// response body, so this is a memory ceiling as much as a count.
const MAX_ENTRIES = 120;

/** Map preserves insertion order, which is what makes oldest-first eviction a one-liner. */
const store = new Map();

const keyFor = (config) => `${(config.method || 'get').toLowerCase()} ${config.baseURL || ''}${config.url || ''}${
  config.params ? `?${new URLSearchParams(config.params).toString()}` : ''
}`;

export function getValidator(config) {
  return store.get(keyFor(config))?.etag;
}

export function getCachedData(config) {
  return store.get(keyFor(config))?.data;
}

export function remember(config, etag, data) {
  if (!etag) return;
  const key = keyFor(config);

  // Re-insert so a URL that is actively polled stays fresh in the eviction order rather than
  // ageing out underneath the screen that depends on it.
  store.delete(key);
  store.set(key, { etag, data });

  while (store.size > MAX_ENTRIES) {
    store.delete(store.keys().next().value);
  }
}

/**
 * Emptied on sign-out and on a 401.
 *
 * Not a nicety: the entries hold patient data, and the next person to use this browser must not
 * be able to receive a 304 that resolves to the previous account's queue.
 */
export function clearRevalidationCache() {
  store.clear();
}

/** For tests and diagnostics. */
export const cacheSize = () => store.size;
