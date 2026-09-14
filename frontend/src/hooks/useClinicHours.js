import { useEffect, useState } from 'react';
import api from '../config/api';

/**
 * The clinic's weekly opening hours, from the public endpoint the booking calendar reads. [1.72.0]
 *
 * The FAQ answers "when are you open?" from this rather than from a sentence typed into the page.
 * An admin changes the hours on Clinic Schedule, and a hardcoded answer would go on stating the old
 * ones to every visitor — with nothing anywhere to say it had gone stale.
 *
 *   week      null while loading, then one entry per day: { dayName, isOpen, openTime, closeTime }
 *   upcoming  dates that override the week — closed, or different hours [1.76.0]; the staff
 *             sidebar's "Open now" needs them, or it calls a holiday open
 *   failed    true when the request did not succeed, so the page can say "call us" instead of
 *             presenting an empty week as though the clinic never opens
 */
export function useClinicHours() {
  const [state, setState] = useState({ week: null, upcoming: [], failed: false });

  useEffect(() => {
    let cancelled = false;
    api.get('/schedule/public')
      .then((res) => {
        if (!cancelled) {
          setState({ week: res.data?.data?.week || [], upcoming: res.data?.data?.upcoming || [], failed: false });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ week: [], upcoming: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
