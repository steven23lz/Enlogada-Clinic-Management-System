/**
 * The same lockout for an address that has no account. [1.173.0]
 *
 * A real account is locked after FAILED_LOGIN_THRESHOLD wrong passwords and then answers "This
 * account is locked" (423), which an unknown address never did: a few wrong passwords per address
 * told anyone whether that person has an account at the clinic. This counts failures for addresses
 * with no account the same way, in memory (nothing is written to the database for an address that
 * does not exist), so both answer alike. One server holds it; a restart forgets it, as it forgets
 * nothing that matters.
 *
 * Mirrors userRepository.registerFailedLogin: a lock that has run out starts the count again at 1,
 * the failure that reaches the threshold sets the lock, and the next attempt is refused as locked.
 */

const MAX_TRACKED = 10000;

function createPhantomLockout({ threshold, lockMinutes, now = () => Date.now() }) {
  const entries = new Map();

  const prune = () => {
    if (entries.size < MAX_TRACKED) return;
    const t = now();
    for (const [key, e] of entries) if (!e.lockedUntil || e.lockedUntil <= t) entries.delete(key);
    // Still full of live locks: drop the oldest rather than grow without bound.
    while (entries.size >= MAX_TRACKED) entries.delete(entries.keys().next().value);
  };

  return {
    /** Minutes left on a lock for this address, or 0 if it is not locked. */
    lockedMinutes(key) {
      const e = entries.get(key);
      if (!e?.lockedUntil || e.lockedUntil <= now()) return 0;
      return Math.max(1, Math.ceil((e.lockedUntil - now()) / 60000));
    },

    /** Counts a failed sign-in for this address. */
    fail(key) {
      const t = now();
      const e = entries.get(key);
      const expired = e?.lockedUntil && e.lockedUntil <= t;
      const count = !e || expired ? 1 : e.count + 1;
      prune();
      entries.set(key, { count, lockedUntil: count >= threshold ? t + lockMinutes * 60000 : null });
    },

    size: () => entries.size,
  };
}

module.exports = { createPhantomLockout };
