import { useCallback, useEffect, useRef, useState } from 'react';
import { todayStr } from '../lib/date';

/**
 * A date that starts as today and stays today until the person picks one. [1.172.0]
 *
 * Transaction History, Visit History and Cashier Monitoring opened on today's date with
 * `useState(todayStr())`, which is read once. A reception PC left on overnight opened the next
 * morning on yesterday's receipts under a filter everyone reads as "today". This follows the
 * calendar (checked each minute, and when the window comes back into view) for as long as nobody
 * has chosen a date; once they have, it is theirs and stays put.
 *
 * @returns {[string, (value: string) => void]}
 */
export function useFollowingToday() {
  const [value, setValue] = useState(todayStr());
  const chosen = useRef(false);

  useEffect(() => {
    const follow = () => {
      if (chosen.current) return;
      const now = todayStr();
      setValue((current) => (current === now ? current : now));
    };
    const id = setInterval(follow, 60000);
    window.addEventListener('focus', follow);
    document.addEventListener('visibilitychange', follow);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', follow);
      document.removeEventListener('visibilitychange', follow);
    };
  }, []);

  const choose = useCallback((next) => {
    chosen.current = true;
    setValue(next);
  }, []);

  return [value, choose];
}

export default useFollowingToday;
