import React, { useEffect, useState } from 'react';

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * "Send a new code", with the wait shown instead of a button that silently does nothing. [1.73.0]
 *
 * The server keeps the real rule — 60 seconds between codes, three resends a ticket — and says how
 * long is left; this only counts down from what it said. `onResend` resolves to the next wait in
 * seconds, or to nothing when it failed (the form shows its own error then).
 *
 * The countdown is deliberately not a live region: a screen reader reading every second aloud
 * would drown out the page. The field it serves is where attention belongs.
 */
export default function ResendCode({ waitSeconds = 60, onResend, disabled }) {
  const [wait, setWait] = useState(waitSeconds);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const resend = async () => {
    setSending(true);
    try {
      const next = await onResend();
      if (typeof next === 'number') setWait(next);
    } finally {
      setSending(false);
    }
  };

  return (
    <p className="m-0 text-center text-note text-slate-500">
      {wait > 0 ? (
        <>
          You can ask for a new code in{' '}
          <span className="font-semibold tabular-nums text-slate-700">{clock(wait)}</span>.
        </>
      ) : (
        <>
          Didn’t get it?{' '}
          <button type="button" onClick={resend} disabled={sending || disabled} className="auth-link disabled:opacity-60">
            Send a new code
          </button>
        </>
      )}
    </p>
  );
}
