import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import Pagination from '../../components/ui/pagination';
import api from '../../config/api';
import { Activity as ActivityIcon, AlertCircle } from 'lucide-react';

// Feature Gap Plan Phase D: previously the only "who did what" visibility was per-row
// attribution columns (processed_by, released_by, ...) — no queryable history of edits and no
// aggregate feed. Backed by the new audit_log table + GET /admin/activity, scoped to the
// sensitive actions this session's other phases added logging for (payments, staff accounts,
// HMO providers, result corrections) rather than every write in the app.
const ACTION_TONES = {
  'payment.refunded': 'text-rose-700 bg-rose-50 border-rose-200',
  'payment.cancelled': 'text-rose-700 bg-rose-50 border-rose-200',
  'staff.password_reset': 'text-indigo-700 bg-indigo-50 border-indigo-200',
  'staff.activated': 'text-emerald-700 bg-emerald-50 border-emerald-200',
  'staff.deactivated': 'text-gray-700 bg-gray-100 border-gray-200',
  'hmo_provider.created': 'text-emerald-700 bg-emerald-50 border-emerald-200',
  'hmo_provider.updated': 'text-amber-700 bg-amber-50 border-amber-200',
  'result.corrected': 'text-amber-700 bg-amber-50 border-amber-200',
  // UI/UX Modernization Phase 12: HMO approval moved from self-service (Receptionist) to
  // Admin/SuperAdmin-only, now audit-logged for the first time.
  'hmo_request.approved': 'text-emerald-700 bg-emerald-50 border-emerald-200',
  'hmo_request_test.approved': 'text-emerald-700 bg-emerald-50 border-emerald-200',
  'hmo_request_test.rejected': 'text-rose-700 bg-rose-50 border-rose-200',
};
const DEFAULT_TONE = 'text-gray-700 bg-gray-100 border-gray-200';

const ActivityLog = () => {
  const [entries, setEntries] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchActivity = useCallback(async (pageNum) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/admin/activity', { params: { page: pageNum, limit: 25 } });
      setEntries(res.data.data.entries || []);
      setTotalPages(res.data.data.totalPages || 1);
      setTotal(res.data.data.total || 0);
    } catch (err) {
      console.error('Failed to fetch activity log:', err);
      setError('Could not load the activity log. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivity(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs space-y-1">
        <h2 className="text-xl font-bold text-slate-900 m-0">Activity Log</h2>
        <p className="text-xs text-gray-500 m-0">
          Who did what — payment refunds/cancellations, staff account changes, HMO provider changes, and result corrections.
        </p>
      </div>

      <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
        <CardHeader className="border-b border-gray-100 py-4 px-6 flex flex-row items-center space-x-2">
          <ActivityIcon className="w-4 h-4 text-[#769046]" />
          <CardTitle className="text-sm font-bold text-slate-800">{total} Recorded Action{total === 1 ? '' : 's'}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="text-center py-8 text-xs text-rose-600 font-semibold">
              <AlertCircle className="w-4 h-4 inline mr-1 -mt-0.5" />
              {error}{' '}
              <button type="button" onClick={() => fetchActivity(page)} className="underline font-bold border-0 bg-transparent cursor-pointer text-rose-700">
                Retry
              </button>
            </div>
          ) : loading ? (
            <p className="text-center py-8 text-xs text-gray-400">Loading activity…</p>
          ) : entries.length === 0 ? (
            <p className="text-center py-8 text-xs text-gray-400 italic">No recorded activity yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 m-0 p-0 list-none">
              {entries.map(entry => (
                <li key={entry.id} className="flex items-start justify-between gap-3 px-6 py-3.5">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-semibold text-slate-800 m-0">{entry.description}</p>
                    <p className="text-fine text-gray-400 m-0">
                      {entry.actor_name} &middot; {new Date(entry.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span className={`text-meta font-bold uppercase tracking-wide px-2 py-1 rounded-full border whitespace-nowrap ${ACTION_TONES[entry.action] || DEFAULT_TONE}`}>
                    {entry.action.replace(/[._]/g, ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalLabel={`${total} total`} />
      </Card>
    </div>
  );
};

export default ActivityLog;
