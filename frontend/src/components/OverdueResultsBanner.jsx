import React, { useCallback, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import api from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { usePolling } from '../hooks/usePolling';
import { Button } from './ui/button';

const WORKLIST = { Laboratory: 'lab-ops', Ultrasound: 'ultrasound-ops', Xray: 'xray-ops' };
const SHOWN = 3;

/**
 * Patients in the queue with no uploaded test result, past their hour or with closing 15 minutes away, on
 * every screen of whoever answers for them. [1.163.0] Steven's "hard notification". Above the scrolling
 * screen and with no dismiss: it goes when the result is uploaded, not when someone has read it. A failed read shows nothing, because the
 * worklist and its red badges are still there, and this must never claim something it could not check.
 */
export default function OverdueResultsBanner({ activeNav, onSelectNav }) {
  const { hasPermission } = useAuth();
  const allowed = hasPermission('results:read');
  const [departments, setDepartments] = useState([]);

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const res = await api.get('/results/overdue');
      setDepartments(res.data.data.overdue || []);
    } catch {
      /* the worklist still shows it */
    }
  }, [allowed]);

  // On opening, then every minute, and straight away on coming back to the tab.
  React.useEffect(() => { load(); }, [load, activeNav]);
  usePolling(load, 60000, { enabled: allowed });

  if (!allowed || departments.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Patients past the turnaround time"
      data-testid="overdue-results"
      className="flex flex-col gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-rose-900 sm:px-6 lg:px-7"
    >
      {departments.map((d) => (
        <div key={d.department} data-testid="overdue-department" data-department={d.department} className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-700" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-fine">
            <p className="m-0 font-bold">
              {d.label}: no test result uploaded for {d.patients.length} {d.patients.length === 1 ? 'test' : 'tests'}
              {d.closesAt ? `, and the clinic closes at ${d.closesAt}` : ` after ${d.minutes} minutes`}
            </p>
            <p className="m-0">
              {d.patients.slice(0, SHOWN).map((p) => `${p.ticket ? `${p.ticket} ` : ''}${p.name}, ${p.test} (${p.waited} min)`).join(' · ')}
              {d.patients.length > SHOWN && ` · and ${d.patients.length - SHOWN} more`}
            </p>
          </div>
          {activeNav !== WORKLIST[d.department] && (
            <Button type="button" size="xs" variant="outline" onClick={() => onSelectNav?.(WORKLIST[d.department])}>
              Go to the worklist
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
