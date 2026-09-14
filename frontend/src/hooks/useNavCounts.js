import { useCallback, useEffect, useState } from 'react';
import api from '../config/api';
import { usePolling } from './usePolling';

const WORKLIST_CATEGORY = { 'lab-ops': 'Laboratory', 'ultrasound-ops': 'Ultrasound', 'xray-ops': 'Xray' };

/**
 * The figure beside each screen in the staff sidebar. [1.76.0]
 *
 * Each is the SAME number the screen shows, worked out the same way, because a badge saying 3
 * beside a list of 2 is worse than no badge:
 *
 *   Desk             today's open visits: the Desk's own "in the queue"
 *   Billing Queue    unpaid visits less those already paid today: the till's own rule
 *                    (useBillingQueue's paidVisitIds). The server's Pending count would also hold a
 *                    booking paid online and not yet checked in, which the till does not list.
 *   Online Payments  proofs waiting to be checked
 *   a worklist       tickets waiting in that department
 *
 * A figure that failed to load is left OUT, never set to 0. No badge claims nothing; a 0 would
 * claim the list is empty. [1.74.0]
 *
 * Only for screens in THIS person's sidebar, once a minute, paused while the tab is hidden. The
 * URLs are the ones the screens themselves poll, so an unchanged answer is a 0-byte 304 through the
 * revalidation cache rather than a second copy of the list.
 *
 * @param {string[]} ids  the nav ids the sidebar is showing
 * @returns {Record<string, number>}
 */
export function useNavCounts(ids = []) {
  const key = ids.join('|');
  const [counts, setCounts] = useState({});

  const load = useCallback(async () => {
    const wanted = new Set(key ? key.split('|') : []);
    const next = {};
    const jobs = [];

    if (wanted.has('reception-queue')) {
      jobs.push(api.get('/visits/active', { params: { page: 1, limit: 1 } }).then((res) => {
        next['reception-queue'] = Number(res.data.data.total) || 0;
      }));
    }
    if (wanted.has('cashier-queue')) {
      jobs.push(Promise.all([api.get('/visits/active'), api.get('/payments/transactions')]).then(([visits, log]) => {
        const paid = new Set(
          (log.data.data.transactions || [])
            .filter((t) => t.payment_status === 'Paid')
            .map((t) => t.patient_visit_id)
        );
        next['cashier-queue'] = (visits.data.data.visits || []).filter((v) => !paid.has(v.id)).length;
      }));
    }
    if (wanted.has('cashier-payments')) {
      jobs.push(api.get('/payment-submissions/pending').then((res) => {
        next['cashier-payments'] = (res.data.data.submissions || []).length;
      }));
    }
    Object.entries(WORKLIST_CATEGORY).forEach(([id, category]) => {
      if (!wanted.has(id)) return;
      jobs.push(api.get(`/results/pending/${category}`).then((res) => {
        next[id] = (res.data.data.pending || []).length;
      }));
    });

    await Promise.allSettled(jobs);
    setCounts(next);
  }, [key]);

  useEffect(() => {
    load();
  }, [load]);

  usePolling(load, 60000);

  return counts;
}

export default useNavCounts;
